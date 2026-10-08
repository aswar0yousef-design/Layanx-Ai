import {spawn,execFile,type ChildProcess} from "node:child_process";
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

export function detectProject(dir:string):ProjectInfo{
  const has=(f:string)=>fs.existsSync(path.join(dir,f));
  let stack:Stack="unknown",scripts:string[]=[],pm:ProjectInfo["packageManager"];
  if(has("package.json")){
    stack="node";
    try{const pkg=JSON.parse(fs.readFileSync(path.join(dir,"package.json"),"utf8")) as {scripts?:Record<string,unknown>};scripts=Object.keys(pkg.scripts??{}).filter(k=>typeof pkg.scripts?.[k]==="string");}catch{}
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

export function runOnce(cmd:Cmd,cwd:string,timeoutMs:number,env?:NodeJS.ProcessEnv):Promise<{command:string;cwd:string;exitCode:number|null;timedOut:boolean;stdout:string;stderr:string;durationMs:number}>{
  const started=Date.now();
  return new Promise(resolve=>{
    let stdout="",stderr="",timedOut=false;
    const child=spawn(cmd.command,cmd.args,{cwd,shell:false,windowsHide:true,env:env??childEnv(),detached:process.platform!=="win32"});
    const timer=setTimeout(()=>{timedOut=true;killTree(child);},timeoutMs);
    child.stdout?.setEncoding("utf8").on("data",(c:string)=>{stdout=(stdout+c).slice(-MAX_OUT);});
    child.stderr?.setEncoding("utf8").on("data",(c:string)=>{stderr=(stderr+c).slice(-MAX_OUT);});
    child.on("error",e=>{clearTimeout(timer);resolve({command:cmd.label,cwd,exitCode:null,timedOut,stdout,stderr:stderr+String(e.message),durationMs:Date.now()-started});});
    child.on("close",code=>{clearTimeout(timer);resolve({command:cmd.label,cwd,exitCode:code,timedOut,stdout,stderr,durationMs:Date.now()-started});});
  });
}
function killTree(child:ChildProcess){
  if(!child.pid)return;
  if(process.platform==="win32")execFile("taskkill",["/pid",String(child.pid),"/t","/f"],{windowsHide:true},()=>undefined);
  else{try{process.kill(-child.pid,"SIGTERM");}catch{try{child.kill("SIGTERM");}catch{}}}
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
    const result=await runOnce(cmd,dir,TIMEOUTS[task]??10*60_000,env);
    const gitWarning=[prepWarning,gitBefore?await verifyGitAfterRun(dir,gitBefore):undefined].filter(Boolean).join(" ")||undefined;
    const ok=result.exitCode===0&&!result.timedOut;
    if(["test","build","lint","typecheck"].includes(task))updateHealth(dir,task,{ok,summary:ok?`${cmd.label} passed`:(result.stderr||result.stdout).slice(-500)});
    return{task,stack:info.stack,isolation,...result,ok:ok&&!gitWarning,...(gitWarning?{gitWarning}:{})};
  }};
}
