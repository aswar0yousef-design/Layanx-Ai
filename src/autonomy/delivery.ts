/** Local, inspectable delivery manifest. Does not package or upload project files. */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import type {OutcomeReport} from "./outcome.js";

export interface DeliveryArtifact {path:string;bytes:number;sha256:string|null}
export interface DeliveryManifest {
  version:1;
  jobId:string;
  projectRoot:string;
  outcomeReference:string;
  verificationScope:"automated-gates";
  createdAt:string;
  artifacts:DeliveryArtifact[];
  commands:string[];
}
const skipDirs=new Set(["node_modules",".git",".layanx",".next",".cache","coverage"]);
const privateName=/(^\.env(?:\.|$)|secrets?|credentials?|password|token|private[-_.]?key|^id_rsa|\.pem$|\.p12$|\.pfx$|\.key$|\.sqlite$|\.db$)/i;
function inventory(root:string):DeliveryArtifact[]{
  const files:DeliveryArtifact[]=[];
  const visit=(dir:string)=>{
    if(files.length>=500)throw Error("Project file inventory exceeds 500 artifacts; delivery cannot be claimed complete.");
    const entries=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      if(files.length>=500)throw Error("Project file inventory exceeds 500 artifacts; delivery cannot be claimed complete.");
      if(privateName.test(entry.name)||entry.isSymbolicLink())continue;
      const abs=path.join(dir,entry.name);
      if(entry.isDirectory()){if(!skipDirs.has(entry.name))visit(abs);continue;}
      if(!entry.isFile())continue;
      const stat=fs.statSync(abs);
      const rel=path.relative(root,abs).replace(/\\/g,"/");
      let sha256:string|null=null;
      if(stat.size<=8*1024*1024)sha256=createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
      files.push({path:rel,bytes:stat.size,sha256});
    }
  };
  visit(root);
  return files;
}
function runCommands(root:string):string[]{
  const packageFile=path.join(root,"package.json");
  if(!fs.existsSync(packageFile))return [];
  let pkg:unknown;
  try{pkg=JSON.parse(fs.readFileSync(packageFile,"utf8"));}catch{return [];}
  if(!pkg||typeof pkg!=="object")return [];
  const scripts=(pkg as {scripts?:unknown}).scripts;
  if(!scripts||typeof scripts!=="object")return [];
  const commands=[fs.existsSync(path.join(root,"package-lock.json"))?"npm ci":"npm install"];
  for(const name of ["test","build","start","dev"]){
    if(typeof (scripts as Record<string,unknown>)[name]==="string")commands.push("npm run "+name);
  }
  return commands;
}
/** Only successful automated gates may produce a successful delivery manifest. */
export function writeDeliveryManifest(projectRoot:string,jobId:string,outcome:OutcomeReport):{
  manifest:DeliveryManifest;relativePath:string;guideRelativePath:string
}{
  if(outcome.status!=="verified"||outcome.jobId!==jobId)
    throw Error("A matching verified outcome is required before delivery");
  const root=fs.realpathSync(projectRoot);
  if(!fs.statSync(root).isDirectory())throw Error("Project workspace is not a directory");
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(jobId))throw Error("Invalid delivery job ID");
  const relativePath=".layanx/deliveries/"+jobId+".json";
  const target=path.join(root,...relativePath.split("/"));
  const manifest:DeliveryManifest={
    version:1,jobId,projectRoot:root,
    outcomeReference:".layanx/outcomes/"+jobId+".json",
    verificationScope:"automated-gates",
    createdAt:new Date().toISOString(),
    artifacts:inventory(root),commands:runCommands(root)
  };
  if(!manifest.artifacts.length)throw Error("No deliverable project files found");
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  const tmp=target+".tmp";
  try{
    fs.writeFileSync(tmp,JSON.stringify(manifest,null,2),{mode:0o600});
    fs.renameSync(tmp,target);
  }finally{if(fs.existsSync(tmp))fs.rmSync(tmp,{force:true});}
  const guideRelativePath=".layanx/deliveries/"+jobId+".md";
  const guide=path.join(root,...guideRelativePath.split("/"));
  const safe=(v:string)=>v.replace(/[\u0000-\u001F\u007F]/g," ").replace(/[`]/g,"'");
  const lines=[
    "# LayanX verified delivery",
    "",
    "Project: "+safe(root),
    "Job: "+jobId,
    "Scope: automated checks only. Natural-language acceptance criteria are NOT individually certified.",
    "Evidence report: "+manifest.outcomeReference,
    "",
    "## Suggested local commands (review before executing)",
    ...manifest.commands.map(command=>"- "+command),
    "",
    "## Project files",
    ...manifest.artifacts.map(file=>"- "+safe(file.path)+" ("+file.bytes+" bytes"+(file.sha256?", SHA-256 "+file.sha256:"")+")"),
    "",
    "Only indexed files are listed. Files with sensitive-looking names, symlinks, dependencies, and project metadata are excluded."
  ];
  const guideTmp=guide+".tmp";
  try{
    fs.writeFileSync(guideTmp,lines.join("\n")+"\n",{mode:0o600});
    fs.renameSync(guideTmp,guide);
  }finally{if(fs.existsSync(guideTmp))fs.rmSync(guideTmp,{force:true});}
  return {manifest,relativePath,guideRelativePath};
}


/** Inspect a delivered project without executing any agent-produced code or commands.
 * The manifest is locally editable: hashes detect accidental changes against it, not a malicious
 * actor who rewrites both the manifest and files. No signature or external attestation is claimed.
 */
export interface DeliveryVerification {
  ok:boolean;
  jobId:string;
  projectRoot:string;
  checkedFiles:number;
  blockers:string[];
  warnings:string[];
}
export function verifyDeliveryManifest(projectRoot:string,jobId:string):DeliveryVerification{
  const blockers:string[]=[],warnings:string[]=[];
  const checked=new Set<string>();
  let root="";
  const result=():DeliveryVerification=>({ok:blockers.length===0&&warnings.length===0,jobId,projectRoot:root||projectRoot,checkedFiles:checked.size,blockers,warnings});
  try{root=fs.realpathSync(projectRoot);}catch{blockers.push("Project folder is missing");return result();}
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(jobId)){blockers.push("Invalid job ID");return result();}
  const dir=path.join(root,".layanx","deliveries");
  const reportPath=path.join(root,".layanx","outcomes",jobId+".json");
  const manifestPath=path.join(dir,jobId+".json");
  const guidePath=path.join(dir,jobId+".md");
  const safeRead=(file:string,label:string):unknown=>{
    try{return JSON.parse(fs.readFileSync(file,"utf8")) as unknown;}
    catch{blockers.push("Missing or invalid "+label);return null;}
  };
  const manifest=safeRead(manifestPath,"delivery manifest");
  const report=safeRead(reportPath,"outcome report");
  if(!fs.existsSync(guidePath))blockers.push("Missing human-readable delivery guide");
  if(!manifest||typeof manifest!=="object"||Array.isArray(manifest))return result();
  const m=manifest as Partial<DeliveryManifest>;
  if(m.version!==1||m.jobId!==jobId||m.projectRoot!==root||
     m.outcomeReference!==".layanx/outcomes/"+jobId+".json"||m.verificationScope!=="automated-gates")
    blockers.push("Delivery manifest metadata does not match the requested workspace and job");
  if(!report||typeof report!=="object"||Array.isArray(report)||
     (report as Partial<OutcomeReport>).status!=="verified"||
     (report as Partial<OutcomeReport>).jobId!==jobId)
    blockers.push("Delivery outcome is not independently recorded as verified for this job");
  if(!Array.isArray(m.artifacts)||m.artifacts.length===0){blockers.push("No valid deliverable inventory");return result();}
  for(const artifact of m.artifacts){
    if(!artifact||typeof artifact.path!=="string"||
       artifact.path.startsWith("/")||artifact.path.includes("\\")||
       path.posix.isAbsolute(artifact.path)||path.win32.isAbsolute(artifact.path)||
       artifact.path.split("/").some(p=>!p||p==="."||p==="..")||
       artifact.path.startsWith(".layanx/")||checked.has(artifact.path)){
      blockers.push("Invalid or duplicated artifact path in delivery manifest");
      continue;
    }
    checked.add(artifact.path);
    const target=path.join(root,...artifact.path.split("/"));
    try{
      const real=fs.realpathSync(target);
      if(!real.startsWith(root+path.sep))throw Error("Artifact leaves project workspace");
      const stat=fs.lstatSync(target);
      if(!stat.isFile()||stat.isSymbolicLink())throw Error("Artifact is not a regular file");
      if(!Number.isSafeInteger(artifact.bytes)||artifact.bytes!==stat.size)
        throw Error("Artifact size has changed");
      if(typeof artifact.sha256==="string"&&/^[a-f0-9]{64}$/.test(artifact.sha256)){
        const digest=createHash("sha256").update(fs.readFileSync(target)).digest("hex");
        if(digest!==artifact.sha256)throw Error("Artifact SHA-256 mismatch");
      }else{
        warnings.push("Artifact lacks a verifiable SHA-256: "+artifact.path);
      }
    }catch(error){blockers.push("Artifact invalid: "+artifact.path+" ("+(error instanceof Error?error.message:String(error))+")");}
  }
  try{
    const live=inventory(root);
    const names=new Set(live.map(f=>f.path));
    for(const artifact of live)if(!checked.has(artifact.path))blockers.push("Unlisted project artifact: "+artifact.path);
    for(const name of checked)if(!names.has(name))blockers.push("Listed project artifact no longer in inventory: "+name);
  }catch(error){blockers.push("Could not independently enumerate project files: "+(error instanceof Error?error.message:String(error)));}
  return result();
}
