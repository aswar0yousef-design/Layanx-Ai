import fs from "node:fs";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {safeChildEnv} from "../platform/safe-env.js";
import {savePlaybookCandidate,scanPlaybook} from "./learning.js";

/**
 * Bringing in outside code without trusting it. A repository or package is fetched at one exact version into a quarantine
 * folder, nothing in it runs, and it is read for the things that hurt. Installing unknown code is how agents get
 * compromised, so nothing leaves quarantine without the owner, and a skill that does is still only a candidate to be measured.
 */
export type IntakeSource="git"|"npm";
export type IntakeStatus="awaiting_owner"|"refused"|"approved"|"rejected";
export interface IntakeFinding{severity:"high"|"medium"|"low";file:string;issue:string}
export interface IntakeRecord{id:string;at:string;source:IntakeSource;target:string;ref:string;why:string;status:IntakeStatus;reason?:string;sha256?:string;fileCount?:number;license?:string;findings:IntakeFinding[];quarantine?:string;skills:string[]}
export interface IntakeOptions{root:string;allowLocalSource?:boolean}

const MAX_FILES=4000,MAX_READ=1_000_000;
const SKIP=new Set([".git"]);
const BINARY=/\.(?:exe|dll|so|dylib|node|bat|cmd|ps1|scr|msi|jar|wasm)$/i;
const TEXT=/\.(?:[cm]?[jt]sx?|json|md|mdx|txt|py|sh|ya?ml|toml|html?|rb|go|rs|php|ps1|bat|cmd)$/i;
const SKILL_FILE=/(?:^|\/)SKILL\.md$/i;
const RULES:Array<{severity:IntakeFinding["severity"];issue:string;test:RegExp}>=[
  {severity:"high",issue:"Pipes a download into a shell",test:/(?:curl|wget)\b[^\n|]*\|\s*(?:ba|z)?sh\b|iwr\b[^\n|]*\|\s*iex\b|Invoke-WebRequest[^\n|]*\|\s*Invoke-Expression/i},
  {severity:"high",issue:"Runs an encoded command",test:/powershell[^\n]*-e(?:nc(?:odedcommand)?)?\s+[A-Za-z0-9+/=]{20,}/i},
  {severity:"high",issue:"Executes hidden, encoded code",test:/\beval\s*\(\s*(?:atob|Buffer\.from)\s*\(|new\s+Function\s*\(\s*(?:atob|Buffer\.from)\s*\(/},
  {severity:"high",issue:"Opens a reverse shell",test:/\/dev\/tcp\/|nc\s+-e\s|bash\s+-i\s+>&/},
  {severity:"high",issue:"Reads credentials or browser data",test:/\.ssh[\\/]+id_|\.aws[\\/]+credentials|Login Data|Local State|wallet\.dat|secrets\.vault/},
  {severity:"high",issue:"Mines cryptocurrency",test:/stratum\+tcp|xmrig|coinhive/i},
  {severity:"medium",issue:"Sends environment variables over the network",test:/fetch\s*\([^\n]*process\.env|JSON\.stringify\(\s*process\.env\s*\)/},
  {severity:"medium",issue:"Starts other programs",test:/child_process|subprocess\.(?:Popen|run)|os\.system\(/}
];
const LIFECYCLE=["preinstall","install","postinstall","prepare"];

export function pinRefusal(source:IntakeSource,target:string,ref:string,options:Pick<IntakeOptions,"allowLocalSource">={}):string|undefined{
  if(source==="git"){
    if(!/^[a-f0-9]{40}$/.test(ref))return"A repository must be pinned to a full 40-character commit, not a branch or a tag.";
    if(options.allowLocalSource&&path.isAbsolute(target))return undefined;
    let url:URL;try{url=new URL(target);}catch{return"The repository address is not valid.";}
    if(url.protocol!=="https:"||url.username||url.password)return"Only https addresses without credentials are accepted.";
    return undefined;
  }
  if(!/^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(target))return"The package name is not valid.";
  return/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(ref)?undefined:"A package must be pinned to one exact version.";
}
function allFiles(dir:string):string[]{
  const found:string[]=[];
  const visit=(folder:string)=>{
    for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
      if(found.length>=MAX_FILES||SKIP.has(entry.name)||entry.isSymbolicLink())continue;
      const full=path.join(folder,entry.name);
      if(entry.isDirectory())visit(full);else found.push(path.relative(dir,full).replace(/\\/g,"/"));
    }
  };
  visit(dir);
  return found.sort();
}
/** Reads what was fetched. Nothing in it is executed. */
export function scanTree(dir:string):{findings:IntakeFinding[];sha256:string;fileCount:number;license?:string;skills:string[]}{
  const files=allFiles(dir),hash=createHash("sha256"),findings:IntakeFinding[]=[];
  let license:string|undefined;
  for(const file of files){
    const content=fs.readFileSync(path.join(dir,file));
    hash.update(file).update("\0").update(content);
    if(BINARY.test(file))findings.push({severity:"medium",file,issue:"Contains a program that cannot be read"});
    if(/^LICEN[CS]E/i.test(path.posix.basename(file))&&!license)license=content.toString("utf8").trim().split(/\r?\n/)[0]!.slice(0,80);
    if(!TEXT.test(file)||content.length>MAX_READ)continue;
    const text=content.toString("utf8");
    for(const rule of RULES)if(rule.test.test(text))findings.push({severity:rule.severity,file,issue:rule.issue});
    if(path.posix.basename(file)==="package.json"){
      try{
        const manifest=JSON.parse(text);
        license??=typeof manifest.license==="string"?manifest.license:undefined;
        for(const name of LIFECYCLE)if(manifest.scripts?.[name])findings.push({severity:"high",file,issue:`Runs code at install: ${name}`});
      }catch{findings.push({severity:"low",file,issue:"package.json does not parse"});}
    }
    if(SKILL_FILE.test(file)||/\.md$/i.test(file))for(const issue of scanPlaybook(text))findings.push({severity:SKILL_FILE.test(file)?"high":"medium",file,issue});
  }
  if(!license)findings.push({severity:"medium",file:".",issue:"No license found: it may not be legal to use"});
  return{findings,sha256:hash.digest("hex"),fileCount:files.length,skills:files.filter(file=>SKILL_FILE.test(file)),...(license?{license}:{})};
}
const exec=promisify(execFile);
async function run(command:string,args:string[],cwd:string){
  try{return(await exec(command,args,{cwd,encoding:"utf8",windowsHide:true,timeout:180_000,maxBuffer:32*1024*1024,env:safeChildEnv(),shell:process.platform==="win32"&&command==="npm"})).stdout;}
  catch(error){const failure=error as{stderr?:string;stdout?:string;message:string};throw new Error(`${command} ${args[0]??""}: ${(failure.stderr||failure.stdout||failure.message).trim().slice(0,300)}`);}
}
async function fetchPinned(source:IntakeSource,target:string,ref:string,into:string){
  if(source==="git"){
    // No hooks, no symlinks and no submodules: fetching must not be able to run or reach anything.
    const safe=["-c","core.hooksPath=/dev/null","-c","core.symlinks=false","-c","protocol.ext.allow=never","-c","advice.detachedHead=false"];
    await run("git",[...safe,"init","-q"],into);
    await run("git",[...safe,"fetch","-q","--depth","1",target,ref],into);
    await run("git",[...safe,"checkout","-q","FETCH_HEAD"],into);
    fs.rmSync(path.join(into,".git"),{recursive:true,force:true});
    return;
  }
  const holder=into+"-pack";
  fs.mkdirSync(holder,{recursive:true});
  await run("npm",["pack",`${target}@${ref}`,"--ignore-scripts","--silent","--pack-destination",holder],holder);
  const archive=fs.readdirSync(holder).find(name=>name.endsWith(".tgz"));
  if(!archive)throw new Error("npm returned no package.");
  await run("tar",["-xzf",path.join(holder,archive),"-C",into,"--strip-components=1"],holder);
  fs.rmSync(holder,{recursive:true,force:true});
}
const recordsFile=(root:string)=>path.join(root,"intake.json");
export const listIntake=(root:string):IntakeRecord[]=>{try{return JSON.parse(fs.readFileSync(recordsFile(root),"utf8"));}catch{return[];}};
function saveIntake(root:string,record:IntakeRecord){
  fs.mkdirSync(root,{recursive:true});
  fs.writeFileSync(recordsFile(root),JSON.stringify([...listIntake(root).filter(item=>item.id!==record.id),record],null,2),{mode:0o600});
  return record;
}
export async function requestIntake(input:{source:IntakeSource;target:string;ref:string;why:string},options:IntakeOptions):Promise<IntakeRecord>{
  const record:IntakeRecord={id:randomUUID(),at:new Date().toISOString(),...input,status:"refused",findings:[],skills:[]};
  const refused=pinRefusal(input.source,input.target,input.ref,options);
  if(refused)return saveIntake(options.root,{...record,reason:refused});
  const quarantine=path.join(options.root,"quarantine",record.id);
  fs.mkdirSync(quarantine,{recursive:true});
  try{await fetchPinned(input.source,input.target,input.ref,quarantine);}
  catch(error){fs.rmSync(quarantine,{recursive:true,force:true});return saveIntake(options.root,{...record,reason:"Could not fetch it: "+(error as Error).message});}
  const scan=scanTree(quarantine);
  const blocked=scan.findings.filter(finding=>finding.severity==="high");
  if(blocked.length){
    fs.rmSync(quarantine,{recursive:true,force:true});
    return saveIntake(options.root,{...record,...scan,reason:"Refused: "+blocked.slice(0,4).map(item=>`${item.issue} (${item.file})`).join("; ")});
  }
  return saveIntake(options.root,{...record,...scan,status:"awaiting_owner",quarantine});
}
/** Only the owner calls this. The files must still be exactly what was scanned. */
export function decideIntake(root:string,id:string,decision:"approved"|"rejected"):IntakeRecord{
  const record=listIntake(root).find(item=>item.id===id);
  if(!record)throw new Error("intake_not_found");
  if(record.status!=="awaiting_owner")throw new Error("intake_not_awaiting_owner");
  if(decision==="rejected"){fs.rmSync(record.quarantine!,{recursive:true,force:true});return saveIntake(root,{...record,status:"rejected"});}
  if(scanTree(record.quarantine!).sha256!==record.sha256){fs.rmSync(record.quarantine!,{recursive:true,force:true});return saveIntake(root,{...record,status:"refused",reason:"The files changed after they were scanned."});}
  return saveIntake(root,{...record,status:"approved"});
}
/** An approved skill becomes a candidate playbook. It is used only after it wins on the benchmark. */
export function adoptSkill(root:string,id:string,skill:string,env:NodeJS.ProcessEnv=process.env){
  const record=listIntake(root).find(item=>item.id===id);
  if(record?.status!=="approved")throw new Error("intake_not_approved");
  if(!record.skills.includes(skill))throw new Error("intake_skill_unknown");
  const body=fs.readFileSync(path.join(record.quarantine!,skill),"utf8");
  return savePlaybookCandidate({title:path.posix.basename(path.posix.dirname(skill))||record.target,tags:["external"],stacks:[],body,note:`From ${record.target} at ${record.ref}`},env);
}
