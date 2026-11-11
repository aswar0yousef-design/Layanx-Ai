import {spawn,execFile,execFileSync,type ChildProcess} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type {ToolAdapter} from "../tools/executor.js";
import type {ToolRequest} from "../core/types.js";
import {safeChildEnv} from "../platform/safe-env.js";
import {projectDir} from "./project-dir.js";
import {updateHealth} from "./knowledge.js";
import {dockerRun,dockerVersion,isolationLevel,restrictedAvailable,withoutInstallScripts,type Isolation} from "./sandbox.js";
import {gitSnapshot,prepareRestricted,restrictedCommand,restrictedEnv,verifyGitAfterRun} from "../platform/windows-sandbox.js";
import net from "node:net";
import os from "node:os";

/**
 * project.run: everything needed to build and check a project without a free-form shell.
 * Commands come from fixed templates per stack; the only free text is a package.json script
 * name that must exist and match ^[\w:.-]+$. Child processes never receive LayanX's secrets.
 *
 * tasks: detect | install | test | build | lint | typecheck | script | dev:start | dev:stop | dev:status
 */
export type Stack="node"|"python"|"flutter"|"dotnet"|"unknown";
export interface ProjectInfo{dir:string;stack:Stack;packageManager?:"npm"|"pnpm"|"yarn";scripts:string[];hasLockfile:boolean;git:boolean;tasks:string[]}
type Cmd={command:string;args:string[];label:string};

const MAX_OUT=64*1024;
const TIMEOUTS:Record<string,number>={install:15*60_000,test:10*60_000,build:10*60_000,lint:5*60_000,typecheck:5*60_000,script:10*60_000};

const NO_TEST=/no test specified.*exit 1/i;
/** True when package.json's test script is the placeholder `npm init` writes (it only fails). */
export function placeholderTest(dir:string):boolean{
  try{const v=(JSON.parse(fs.readFileSync(path.join(dir,"package.json"),"utf8")) as {scripts?:Record<string,unknown>}).scripts?.test;return typeof v==="string"&&NO_TEST.test(v);}catch{return false;}
}
export function detectProject(dir:string):ProjectInfo{
  const has=(f:string)=>fs.existsSync(path.join(dir,f));
  let stack:Stack="unknown",scripts:string[]=[],pm:ProjectInfo["packageManager"];
  if(has("package.json")){
    stack="node";
    // `npm init` writes a test script that only fails ("Error: no test specified"): it is not a test, and
    // as a check it stopped every autonomous job at its first milestone.
    try{const pkg=JSON.parse(fs.readFileSync(path.join(dir,"package.json"),"utf8")) as {scripts?:Record<string,unknown>};scripts=Object.keys(pkg.scripts??{}).filter(k=>typeof pkg.scripts?.[k]==="string"&&!(k==="test"&&NO_TEST.test(String(pkg.scripts[k]))));}catch{}
    pm=has("pnpm-lock.yaml")?"pnpm":has("yarn.lock")?"yarn":"npm";
  }else if(has("pubspec.yaml"))stack="flutter";
  else if(has("pyproject.toml")||has("requirements.txt")||has("setup.py"))stack="python";
  else if(fs.existsSync(dir)&&fs.readdirSync(dir).some(f=>/\.(csproj|sln|fsproj)$/i.test(f)))stack="dotnet";
  const hasLockfile=has("package-lock.json")||has("pnpm-lock.yaml")||has("yarn.lock")||has("poetry.lock")||has("pubspec.lock");
  const tasks=["install",...["test","build","lint","typecheck"].filter(t=>stack!=="node"||scripts.includes(t)),...(stack==="node"&&scripts.some(s=>["dev","start","serve"].includes(s))?["dev:start"]:[]),...(stack==="flutter"||stack==="dotnet"?["test","build"]:[])];
  return{dir,stack,...(pm?{packageManager:pm}:{}),scripts,hasLockfile,git:has(".git"),tasks:[...new Set(tasks)]};
}

/** npm without cmd.exe: run npm-cli.js with this Node (the same way npm's own shim does). */
function npmCli():{command:string;prefix:string[]}{
  const dir=path.dirname(process.execPath);
  for(const c of [path.join(dir,"node_modules","npm","bin","npm-cli.js"),path.join(dir,"..","lib","node_modules","npm","bin","npm-cli.js")])
    if(fs.existsSync(c))return{command:process.execPath,prefix:[c]};
  return{command:"npm",prefix:[]};
}
/** npm with these arguments, started without cmd.exe (for other tools that need npm). */
export function npmCommand(args:string[]):Cmd{const npm=npmCli();return{command:npm.command,args:[...npm.prefix,...args],label:"npm "+args.join(" ")};}
const winShim=(name:string,args:string[]):Cmd=>({command:process.env.ComSpec??"cmd.exe",args:["/d","/s","/c",[name,...args].join(" ")],label:[name,...args].join(" ")});
const SAFE_SCRIPT=/^[\w:.-]{1,60}$/;

const NEEDS_PROJECT=["install","test","build","lint","typecheck","script","dev:start"];
/**
 * project.run tasks that need a project, on a folder that has none yet (a new goal, before any file is
 * written): the reason it cannot work. Checked BEFORE the owner is asked to approve, so nobody approves a
 * command that can only fail.
 */
export function emptyProjectReason(projectId:string,payload:unknown):string|undefined{
  const task=payload&&typeof payload==="object"&&typeof (payload as {task?:unknown}).task==="string"?(payload as {task:string}).task.trim():"detect";
  if(!NEEDS_PROJECT.includes(task))return undefined;
  let dir:string;
  try{dir=projectDir(projectId);}catch{return undefined;}
  if(fs.existsSync(dir)&&detectProject(dir).stack!=="unknown")return undefined;
  return `The project folder has no project yet (no package.json, pyproject.toml/requirements.txt, pubspec.yaml or .csproj), so "${task}" has nothing to run. Create the project first: write package.json and the source files with files.write, or use project.bootstrap with the packages it needs. Run project.run after that.`;
}

export function commandFor(info:ProjectInfo,task:string,script?:string):Cmd{
  const npm=npmCli();
  const node=(args:string[]):Cmd=>({command:npm.command,args:[...npm.prefix,...args],label:"npm "+args.join(" ")});
  if(info.stack==="node"){
    if(task==="install")return node(info.hasLockfile&&info.packageManager==="npm"?["ci","--no-audit","--no-fund"]:["install","--no-audit","--no-fund"]);
    const name=task==="script"?script??"":task;
    if(!SAFE_SCRIPT.test(name))throw new Error("Invalid script name.");
    if(!info.scripts.includes(name))throw new Error(`package.json has no "${name}" script.`);
    return node(name==="test"?["test"]:["run",name]);
  }
  if(info.stack==="python"){
    const py=process.platform==="win32"?"python":"python3";
    if(task==="install")return{command:py,args:fs.existsSync(path.join(info.dir,"requirements.txt"))?["-m","pip","install","-r","requirements.txt"]:["-m","pip","install","-e","."],label:"pip install"};
    if(task==="test")return{command:py,args:["-m","pytest","-q"],label:"pytest"};
    if(task==="lint")return{command:py,args:["-m","ruff","check","."],label:"ruff check"};
    if(task==="build")return{command:py,args:["-m","compileall","-q","."],label:"compileall"};
    throw new Error(`Task "${task}" is not available for Python projects.`);
  }
  if(info.stack==="flutter"){
    const args=task==="install"?["pub","get"]:task==="test"?["test"]:task==="lint"?["analyze"]:task==="build"?["build","web"]:null;
    if(!args)throw new Error(`Task "${task}" is not available for Flutter projects.`);
    return process.platform==="win32"?winShim("flutter.bat",args):{command:"flutter",args,label:"flutter "+args.join(" ")};
  }
  if(info.stack==="dotnet"){
    const args=task==="install"?["restore"]:task==="test"?["test"]:task==="build"?["build"]:null;
    if(!args)throw new Error(`Task "${task}" is not available for .NET projects.`);
    return{command:"dotnet",args,label:"dotnet "+args.join(" ")};
  }
  throw new Error("No supported project (package.json, pyproject.toml/requirements.txt, pubspec.yaml or .csproj) was found in the project folder.");
}

function childEnv(){return safeChildEnv({allow:["PYTHONPATH","VIRTUAL_ENV","JAVA_HOME","ANDROID_HOME","FLUTTER_ROOT","DOTNET_ROOT","NVM_HOME","NVM_SYMLINK"],extra:{CI:"1",FORCE_COLOR:"0",NO_COLOR:"1",npm_config_update_notifier:"false"}});}

/** The output of a task, kept in files: with pipes, npm and its shell die with LayanX and their children can no longer be found. */
function outputFiles(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"layanx-run-"));
  const out=fs.openSync(path.join(dir,"out"),"w"),err=fs.openSync(path.join(dir,"err"),"w");
  const tail=(name:string)=>{
    let handle:number|undefined;
    try{
      handle=fs.openSync(path.join(dir,name),"r");
      const size=fs.fstatSync(handle).size,length=Math.min(size,MAX_OUT),buffer=Buffer.alloc(length);
      fs.readSync(handle,buffer,0,length,size-length);
      return buffer.toString("utf8");
    }catch{return"";}finally{if(handle!==undefined)try{fs.closeSync(handle);}catch{}}
  };
  return{out,err,tail,close(){for(const fd of[out,err])try{fs.closeSync(fd);}catch{}},remove(){try{fs.rmSync(dir,{recursive:true,force:true});}catch{}}};
}
export function runOnce(cmd:Cmd,cwd:string,timeoutMs:number,env?:NodeJS.ProcessEnv):Promise<{command:string;cwd:string;exitCode:number|null;timedOut:boolean;stdout:string;stderr:string;durationMs:number}>{
  const started=Date.now();
  return new Promise(resolve=>{
    let timedOut=false,done=false;
    const output=outputFiles();
    const child=spawn(cmd.command,cmd.args,{cwd,shell:false,windowsHide:true,env:env??childEnv(),detached:process.platform!=="win32",stdio:["ignore",output.out,output.err]});
    output.close();
    const timer=setTimeout(()=>{timedOut=true;killTree(child);},timeoutMs);
    activeRuns.set(child,cwd);child.once("close",()=>activeRuns.delete(child));child.once("error",()=>activeRuns.delete(child));
    trackRun(child,cwd,cmd.label);
    const finish=(exitCode:number|null,extra="")=>{
      if(done)return;done=true;clearTimeout(timer);
      const result={command:cmd.label,cwd,exitCode,timedOut,stdout:output.tail("out"),stderr:output.tail("err")+extra,durationMs:Date.now()-started};
      output.remove();resolve(result);
    };
    child.on("error",e=>finish(null,String(e.message)));
    child.on("close",code=>finish(code));
  });
}
const activeRuns=new Map<ChildProcess,string>();
/** Ends every task still running in this project folder. Returns how many were told to stop. */
export function abortProjectRuns(dir:string):number{
  const root=path.resolve(dir)+path.sep;let stopped=0;
  for(const[child,cwd]of activeRuns)if((path.resolve(cwd)+path.sep).startsWith(root)){killTree(child);stopped++;}
  return stopped;
}
function killTree(child:ChildProcess){
  if(!child.pid)return;
  if(process.platform==="win32")execFile("taskkill",["/pid",String(child.pid),"/t","/f"],{windowsHide:true},()=>undefined);
  else{try{process.kill(-child.pid,"SIGTERM");}catch{try{child.kill("SIGTERM");}catch{}}}
}

// ---------------------------------------------------------------- runs that outlive a crash
export interface TrackedRun{pid:number;owner:number;cwd:string;label:string;startedAt:string;family?:number[]}
const runsFile=()=>path.join(path.resolve(process.env.LAYANX_STORE_DIR?.trim()||".layanx"),"active-runs.json");
function readRuns():TrackedRun[]{try{const list=JSON.parse(fs.readFileSync(runsFile(),"utf8"));return Array.isArray(list)?list:[];}catch{return[];}}
function writeRuns(runs:TrackedRun[]){try{const file=runsFile();fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+".tmp",JSON.stringify(runs));fs.renameSync(file+".tmp",file);}catch{}}
function trackRun(child:ChildProcess,cwd:string,label:string){
  const pid=child.pid;if(!pid)return;
  writeRuns([...readRuns(),{pid,owner:process.pid,cwd,label,startedAt:new Date().toISOString()}]);
  const forget=()=>writeRuns(readRuns().filter(run=>!(run.pid===pid&&run.owner===process.pid)));
  child.once("close",forget);child.once("error",forget);
  scheduleFamilySample(1500);
}
/**
 * On Windows npm and its shell die with LayanX while the program they started keeps running, and the link to it is lost.
 * So the processes under each running task are noted while LayanX is alive.
 */
let familyTimer:ReturnType<typeof setTimeout>|undefined;
function scheduleFamilySample(ms:number){
  if(process.platform!=="win32"||familyTimer)return;
  familyTimer=setTimeout(()=>{
    execFile("powershell",["-NoProfile","-Command",PROCESS_TABLE_COMMAND],{encoding:"utf8",windowsHide:true,timeout:20_000,maxBuffer:16*1024*1024},(error,stdout)=>{
      familyTimer=undefined;
      const mine=readRuns().filter(run=>run.owner===process.pid);
      if(!mine.length)return;
      if(!error)try{
        const table=parseProcessTable(stdout);
        writeRuns(readRuns().map(run=>run.owner!==process.pid?run:{...run,family:[...new Set([...(run.family??[]),...descendants(table,[run.pid,...(run.family??[])],Date.parse(run.startedAt))])]}));
      }catch{}
      // New tasks settle in their first seconds, so they are looked at more often.
      scheduleFamilySample(mine.some(run=>Date.now()-Date.parse(run.startedAt)<12_000)?2000:10_000);
    });
  },ms);
  familyTimer.unref?.();
}
const pidAlive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error){return(error as NodeJS.ErrnoException).code==="EPERM";}};
function processStartMs(pid:number):number|undefined{
  try{
    const text=process.platform==="win32"
      ?execFileSync("powershell",["-NoProfile","-Command",`(Get-Process -Id ${pid}).StartTime.ToUniversalTime().ToString('o')`],{encoding:"utf8",windowsHide:true,timeout:10_000})
      :execFileSync("ps",["-o","lstart=","-p",String(pid)],{encoding:"utf8",timeout:10_000});
    const ms=Date.parse(text.trim());return Number.isFinite(ms)?ms:undefined;
  }catch{return undefined;}
}
/**
 * After a crash, a task LayanX started can still be running, unattended and possibly beside its own retry. It is only
 * stopped if the process that owned it is gone and the id still belongs to that same process (ids get reused).
 */
export function reapOrphanRuns():{stopped:string[];left:string[]}{
  const stopped:string[]=[],left:string[]=[],keep:TrackedRun[]=[];
  const abandoned:TrackedRun[]=[];
  for(const run of readRuns()){if(run.owner===process.pid||pidAlive(run.owner))keep.push(run);else abandoned.push(run);}
  const table=abandoned.length&&process.platform==="win32"?processTable():[];
  for(const run of abandoned){
    const began=Date.parse(run.startedAt);
    const seeds=[run.pid,...(run.family??[])];
    // Noted ids count only if that process is still the same one, and whatever they started is found through them.
    const known=(run.family??[]).filter(pid=>table.some(row=>row.ProcessId===pid&&Date.parse(row.Created)>=began-2000));
    const family=process.platform==="win32"?[...new Set([...known,...descendants(table,seeds,began)])]:[];
    const started=pidAlive(run.pid)?processStartMs(run.pid):undefined;
    const rootIsOurs=started!==undefined&&Math.abs(started-began)<=15_000;
    if(pidAlive(run.pid)&&!rootIsOurs&&!family.length){left.push(run.label);continue;}
    const targets=[...(rootIsOurs?[run.pid]:[]),...family];
    if(!targets.length)continue;
    try{
      // taskkill reports failure for a child that went down with its parent, so what counts is who is still there afterwards.
      if(process.platform==="win32")for(const pid of targets)if(pidAlive(pid))try{execFileSync("taskkill",["/pid",String(pid),"/t","/f"],{windowsHide:true,stdio:"ignore",timeout:10_000});}catch{}
      // A task started by LayanX leads its own process group; one that does not (CI: "left" instead of "stopped") is stopped by itself.
      else try{process.kill(-run.pid,"SIGKILL");}catch{if(rootIsOurs)process.kill(run.pid,"SIGKILL");}
      for(let waited=0;waited<3000&&targets.some(pidAlive);waited+=250)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
      (targets.some(pidAlive)?left:stopped).push(run.label);
    }catch{left.push(run.label);}
  }
  writeRuns(keep);
  return{stopped,left};
}
interface ProcessRow{ProcessId:number;ParentProcessId:number;Created:string;Name?:string}
const PROCESS_TABLE_COMMAND="Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,@{n='Created';e={$_.CreationDate.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress";
function parseProcessTable(text:string):ProcessRow[]{const rows=JSON.parse(text);return Array.isArray(rows)?rows:[rows];}
function processTable():ProcessRow[]{
  try{return parseProcessTable(execFileSync("powershell",["-NoProfile","-Command",PROCESS_TABLE_COMMAND],{encoding:"utf8",windowsHide:true,timeout:20_000,maxBuffer:16*1024*1024}));}
  catch{return[];}
}
/** Only processes created after the run began can be its children: a parent id alone may have been reused. The console helper goes by itself. */
function descendants(table:ProcessRow[],seeds:number[],began:number):number[]{
  const found=new Set(seeds);
  for(let grew=true;grew;){
    grew=false;
    for(const row of table)if(!found.has(row.ProcessId)&&found.has(row.ParentProcessId)&&Date.parse(row.Created)>=began-2000&&!/conhost/i.test(row.Name??"")){found.add(row.ProcessId);grew=true;}
  }
  for(const seed of seeds)found.delete(seed);
  return[...found];
}

// ---------------------------------------------------------------- dev servers (one per project)
interface DevServer{child:ChildProcess;command:string;url?:string;log:string;startedAt:string;exitCode?:number|null;container?:string}
const servers=new Map<string,DevServer>();
const URL_RX=/\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})[^\s"'<>]*/i;

function freePort():Promise<number>{return new Promise((res,rej)=>{const srv=net.createServer();srv.unref();srv.on("error",rej);srv.listen(0,"127.0.0.1",()=>{const p=(srv.address() as net.AddressInfo).port;srv.close(()=>res(p));});});}
async function devStart(dir:string,key:string,info:ProjectInfo,script:string|undefined,isolation:Isolation){
  const docker=isolation==="docker";
  const existing=servers.get(key);
  if(existing&&existing.exitCode===undefined)return devStatus(key);
  const name=script??(["dev","start","serve"].find(s=>info.scripts.includes(s)));
  if(!name)throw new Error("No dev/start/serve script in package.json.");
  let cmd:Cmd,container:string|undefined,fixedUrl:string|undefined;
  if(docker){
    const port=await freePort();
    const d=dockerRun(info,"dev:start",{script:name,devPort:port,uid:typeof process.getuid==="function"?`${process.getuid()}:${process.getgid?.()}`:undefined});
    cmd={command:d.command,args:d.args,label:d.label};container=d.name;fixedUrl=`http://localhost:${port}`;
    if(container)await new Promise(r=>execFile("docker",["rm","-f",container!],{windowsHide:true},()=>r(null)));
  }else cmd=commandFor(info,"script",name);
  let env:NodeJS.ProcessEnv={...childEnv(),BROWSER:"none"};
  let gitBefore:{id:string|null}|undefined,prepWarning:string|undefined;
  if(isolation==="restricted"){const setup=await prepareRestricted(dir);cmd=restrictedCommand(cmd,dir,setup);env=restrictedEnv(env,setup);gitBefore=gitSnapshot(dir);prepWarning=setup.gitWarning;}
  const child=spawn(cmd.command,cmd.args,{cwd:dir,shell:false,windowsHide:true,env,detached:process.platform!=="win32"});
  const server:DevServer={child,command:cmd.label,log:prepWarning?prepWarning+"\n":"",startedAt:new Date().toISOString(),...(container?{container}:{})};
  child.on("error",e=>{server.log+=`\n${e.message}`;if(server.exitCode===undefined)server.exitCode=-1;});
  servers.set(key,server);
  trackRun(child,dir,cmd.label);
  const onData=(c:Buffer|string)=>{server.log=(server.log+String(c)).slice(-16*1024);const m=URL_RX.exec(server.log);if(m&&!server.url&&!fixedUrl)server.url=m[0].replace("0.0.0.0","localhost").replace(/[).,]+$/,"");};
  child.stdout?.on("data",onData);child.stderr?.on("data",onData);
  child.on("close",code=>{server.exitCode=code;if(gitBefore)void verifyGitAfterRun(dir,gitBefore).then(w=>{if(w)server.log+="\n"+w;}).catch(()=>undefined);});
  if(fixedUrl){
    // container: the server prints its in-container address; wait until the published port answers
    for(let i=0;i<240&&server.exitCode===undefined;i++){try{const r=await fetch(fixedUrl,{signal:AbortSignal.timeout(1500)});if(r.status<500){server.url=fixedUrl;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
  }else for(let i=0;i<120&&!server.url&&server.exitCode===undefined;i++)await new Promise(r=>setTimeout(r,500));
  return devStatus(key);
}
function devStatus(key:string){
  const s=servers.get(key);
  if(!s)return{running:false};
  return{running:s.exitCode===undefined,url:s.url??null,command:s.command,startedAt:s.startedAt,exitCode:s.exitCode??null,log:s.log.slice(-3000)};
}
function devStop(key:string){const s=servers.get(key);if(s?.container)execFile("docker",["stop","-t","3",s.container],{windowsHide:true},()=>undefined);if(s&&s.exitCode===undefined)killTree(s.child);servers.delete(key);return{stopped:Boolean(s)};}
export function stopAllDevServers(){for(const k of [...servers.keys()])devStop(k);}
process.once("exit",stopAllDevServers);

export function createProjectRunnerAdapter():ToolAdapter{
  return{async execute(request:ToolRequest){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const task=typeof input.task==="string"?input.task.trim():"detect";
    const dir=projectDir(request.projectId);
    if(!fs.existsSync(dir))fs.mkdirSync(dir,{recursive:true});
    const info=detectProject(dir);
    const key=dir.toLowerCase();
    const isolation=isolationLevel(request.projectId);
    const docker=isolation==="docker";
    if(docker&&task!=="detect"&&task!=="dev:status"&&task!=="dev:stop"&&!dockerVersion())
      throw new Error("This project runs in Docker isolation, but Docker is not running. Start Docker Desktop, or choose another isolation level on the Project Board.");
    if(isolation==="restricted"&&task!=="detect"&&task!=="dev:status"&&task!=="dev:stop"){
      if(!restrictedAvailable())throw new Error("Restricted isolation runs on Windows only. Choose no-scripts or Docker for this project.");
      if(info.stack==="flutter")throw new Error("Flutter writes to its own SDK folder, which restricted isolation does not allow. Choose local, no-scripts or Docker for this project.");
    }
    if(task==="detect")return{...info,isolation};
    if(task==="dev:start")return{...(await devStart(dir,key,info,typeof input.script==="string"?input.script:undefined,isolation)),isolation};
    if(task==="dev:status")return devStatus(key);
    if(task==="dev:stop")return devStop(key);
    if(!["install","test","build","lint","typecheck","script"].includes(task))throw new Error("Unknown task. Use detect, install, test, build, lint, typecheck, script, dev:start, dev:status or dev:stop.");
    let cmd=commandFor(info,task,typeof input.script==="string"?input.script:undefined);
    if(docker){const d=dockerRun(info,task,{script:typeof input.script==="string"?input.script:undefined,uid:typeof process.getuid==="function"?`${process.getuid()}:${process.getgid?.()}`:undefined});cmd={command:d.command,args:d.args,label:d.label};}
    else if((isolation==="no-scripts"||isolation==="restricted")&&task==="install"&&info.stack==="node")cmd={...cmd,args:withoutInstallScripts(cmd.args),label:cmd.label+" --ignore-scripts"};
    let env:NodeJS.ProcessEnv|undefined;
    let gitBefore:{id:string|null}|undefined,prepWarning:string|undefined;
    if(isolation==="restricted"){
      // Python packages cannot go to the (read-only) user site: keep them in the project, like Docker does.
      if(info.stack==="python"&&task==="install")cmd={...cmd,args:cmd.args.flatMap(a=>a==="install"?["install","--target",".layanx/pydeps"]:[a]).filter(a=>a!=="-e"),label:cmd.label+" --target .layanx/pydeps"};
      const setup=await prepareRestricted(dir);
      env=restrictedEnv(childEnv(),setup);
      if(info.stack==="python")env.PYTHONPATH=path.join(dir,".layanx","pydeps");
      cmd=restrictedCommand(cmd,dir,setup);
      gitBefore=gitSnapshot(dir);prepWarning=setup.gitWarning;
    }
    // Callers may shorten a task's limit, never extend it.
    const limit=TIMEOUTS[task]??10*60_000;
    const requested=Number(input.timeoutMs);
    const result=await runOnce(cmd,dir,Number.isFinite(requested)&&requested>=1000?Math.min(requested,limit):limit,env);
    const gitWarning=[prepWarning,gitBefore?await verifyGitAfterRun(dir,gitBefore):undefined].filter(Boolean).join(" ")||undefined;
    const ok=result.exitCode===0&&!result.timedOut;
    if(["test","build","lint","typecheck"].includes(task))updateHealth(dir,task,{ok,summary:ok?`${cmd.label} passed`:(result.stderr||result.stdout).slice(-500)});
    return{task,stack:info.stack,isolation,...result,ok:ok&&!gitWarning,...(gitWarning?{gitWarning}:{})};
  }};
}
