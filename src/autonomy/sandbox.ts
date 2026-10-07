import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {ProjectInfo} from "./project-runner.js";

/**
 * Where a project's commands run (per project, like trust levels):
 *
 *   local       on this PC with a clean environment (no LayanX secrets)          — default
 *   no-scripts  local, but `npm install` never runs package install scripts      — blocks the
 *               most common supply-chain attack (malicious postinstall)
 *   docker      inside a throw-away container: no LayanX secrets, no access outside the project
 *               folder, all capabilities dropped, memory/CPU/process limits, and NO network for
 *               tests/build (network only while installing). node_modules lives in a Docker
 *               volume so Linux binaries never mix with Windows ones.
 */
export type Isolation="local"|"no-scripts"|"docker";
export const ISOLATION_LEVELS:Isolation[]=["local","no-scripts","docker"];

let cache:{file:string;mtime:number;map:Record<string,Isolation>}|null=null;
function load(file:string):Record<string,Isolation>{
  try{
    const st=fs.statSync(file);
    if(cache&&cache.file===file&&cache.mtime===st.mtimeMs)return cache.map;
    const raw=JSON.parse(fs.readFileSync(file,"utf8")) as Record<string,unknown>;
    const map:Record<string,Isolation>={};
    for(const [k,v] of Object.entries(raw))if(ISOLATION_LEVELS.includes(v as Isolation))map[k.toLowerCase()]=v as Isolation;
    cache={file,mtime:st.mtimeMs,map};return map;
  }catch{return{};}
}
export function isolationLevel(projectId:string|undefined,env:NodeJS.ProcessEnv=process.env):Isolation{
  const fromFile=env.LAYANX_ISOLATION_FILE&&projectId?load(env.LAYANX_ISOLATION_FILE)[projectId.trim().toLowerCase()]:undefined;
  if(fromFile)return fromFile;
  return ISOLATION_LEVELS.includes(env.LAYANX_DEFAULT_ISOLATION as Isolation)?env.LAYANX_DEFAULT_ISOLATION as Isolation:"local";
}
export function setIsolation(file:string,projectId:string,level:Isolation){
  if(!ISOLATION_LEVELS.includes(level))throw new Error("Invalid isolation level.");
  const map={...load(file)};map[projectId.trim().toLowerCase()]=level;
  fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(map,null,2));cache=null;
}
export function listIsolation(file:string|undefined){return file?{...load(file)}:{};}

let dockerCache:{at:number;version:string|null}|null=null;
export function dockerVersion(force=false):string|null{
  if(!force&&dockerCache&&Date.now()-dockerCache.at<60_000)return dockerCache.version;
  let version:string|null=null;
  try{version=execFileSync("docker",["version","--format","{{.Server.Version}}"],{encoding:"utf8",timeout:8000,windowsHide:true,stdio:["ignore","pipe","ignore"]}).trim()||null;}catch{}
  dockerCache={at:Date.now(),version};return version;
}

const IMAGES:Record<string,string>={node:"node:22-bookworm-slim",python:"python:3.12-slim",dotnet:"mcr.microsoft.com/dotnet/sdk:8.0"};
function image(stack:string,env:NodeJS.ProcessEnv):string{
  const custom=env[`LAYANX_DOCKER_${stack.toUpperCase()}_IMAGE`];
  if(custom&&/^[\w./:@-]+$/.test(custom))return custom;
  const i=IMAGES[stack];
  if(!i)throw new Error(`Docker isolation is not available for ${stack} projects yet; use local or no-scripts.`);
  return i;
}
const SAFE_SCRIPT=/^[\w:.-]{1,60}$/;
export function containerName(dir:string,kind:string){return`layanx-${kind}-${createHash("sha256").update(dir.toLowerCase()).digest("hex").slice(0,12)}`;}

/** Inner command (runs inside the container) for a task. */
export function innerCommand(info:ProjectInfo,task:string,script?:string,devPort?:number):{args:string[];network:boolean;env:Record<string,string>}{
  if(info.stack==="node"){
    if(task==="install")return{args:info.hasLockfile&&info.packageManager==="npm"?["npm","ci","--no-audit","--no-fund"]:["npm","install","--no-audit","--no-fund"],network:true,env:{}};
    const name=task==="script"?script??"":task==="dev:start"?script??["dev","start","serve"].find(x=>info.scripts.includes(x))??"":task;
    if(!SAFE_SCRIPT.test(name)||!info.scripts.includes(name))throw new Error(`package.json has no "${name}" script.`);
    if(task==="dev:start"){
      const p=String(devPort??5173);
      const body=(()=>{try{return String((JSON.parse(fs.readFileSync(path.join(info.dir,"package.json"),"utf8")) as {scripts:Record<string,string>}).scripts[name]??"");}catch{return"";}})();
      const extra=/\b(vite|astro|nuxt|svelte-kit)\b/.test(body)?["--","--host","0.0.0.0","--port",p]:/\bnext\b/.test(body)?["--","-H","0.0.0.0","-p",p]:[];
      return{args:["npm","run",name,...extra],network:true,env:{HOST:"0.0.0.0",PORT:p}};
    }
    return{args:name==="test"?["npm","test"]:["npm","run",name],network:false,env:{}};
  }
  if(info.stack==="python"){
    // --rm containers forget pip installs: keep dependencies inside the project (.layanx/pydeps).
    const deps={PYTHONPATH:"/work/.layanx/pydeps"};
    if(task==="install")return{args:fs.existsSync(path.join(info.dir,"requirements.txt"))?["pip","install","--no-cache-dir","--target",".layanx/pydeps","-r","requirements.txt"]:["pip","install","--no-cache-dir","--target",".layanx/pydeps","."],network:true,env:deps};
    if(task==="test")return{args:["python","-m","pytest","-q"],network:false,env:deps};
    if(task==="build")return{args:["python","-m","compileall","-q","."],network:false,env:deps};
    throw new Error(`Task "${task}" is not available for Python projects in Docker.`);
  }
  if(info.stack==="dotnet"){
    const args=task==="install"?["dotnet","restore"]:task==="test"?["dotnet","test"]:task==="build"?["dotnet","build"]:null;
    if(!args)throw new Error(`Task "${task}" is not available for .NET projects in Docker.`);
    return{args,network:task==="install",env:{DOTNET_CLI_TELEMETRY_OPTOUT:"1",NUGET_PACKAGES:"/work/.layanx/nuget"}};
  }
  throw new Error(`Docker isolation is not available for ${info.stack} projects yet.`);
}

/** Full `docker run` argv. Exported for tests. */
export function dockerRun(info:ProjectInfo,task:string,opts:{script?:string;devPort?:number;env?:NodeJS.ProcessEnv;uid?:string}={}):{command:string;args:string[];label:string;name?:string;port?:number}{
  const env=opts.env??process.env;
  const inner=innerCommand(info,task,opts.script,opts.devPort);
  const dev=task==="dev:start";
  const name=dev?containerName(info.dir,"dev"):undefined;
  const args=["run","--rm","--init",
    ...(name?["--name",name]:[]),
    "--mount",`type=bind,source=${info.dir},target=/work`,
    ...(info.stack==="node"?["--mount",`type=volume,source=${containerName(info.dir,"nm")},target=/work/node_modules`]:[]),
    "-w","/work",
    "--cap-drop","ALL","--security-opt","no-new-privileges","--pids-limit","512",
    "--memory",env.LAYANX_DOCKER_MEMORY&&/^\d+[mg]$/i.test(env.LAYANX_DOCKER_MEMORY)?env.LAYANX_DOCKER_MEMORY:"4g",
    "--cpus",env.LAYANX_DOCKER_CPUS&&/^\d+(\.\d+)?$/.test(env.LAYANX_DOCKER_CPUS)?env.LAYANX_DOCKER_CPUS:"2",
    // Tests and builds run offline unless the owner allows the network (LAYANX_SANDBOX_NETWORK=on).
    "--network",inner.network||env.LAYANX_SANDBOX_NETWORK==="on"?"bridge":"none",
    ...(dev&&opts.devPort?["-p",`127.0.0.1:${opts.devPort}:${opts.devPort}`]:[]),
    ...(opts.uid&&process.platform!=="win32"?["--user",opts.uid]:[]),
    "-e","CI=1","-e","HOME=/tmp","-e","npm_config_update_notifier=false","-e","NO_COLOR=1",
    ...Object.entries(inner.env).flatMap(([k,v])=>["-e",`${k}=${v}`]),
    image(info.stack,env),...inner.args];
  return{command:"docker",args,label:"docker: "+inner.args.join(" "),...(name?{name}:{}),...(opts.devPort?{port:opts.devPort}:{})};
}

/** npm install without install scripts (no-scripts isolation). */
export function withoutInstallScripts(args:string[]):string[]{return args.includes("--ignore-scripts")?args:[...args,"--ignore-scripts"];}
