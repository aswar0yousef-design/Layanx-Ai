import {readFile,readdir,stat,mkdir,writeFile} from "node:fs/promises";
import {resolve,relative,isAbsolute,sep} from "node:path";
import {spawn} from "node:child_process";
import type {ToolRequest} from "../core/types.js";
import type {ToolAdapter} from "./executor.js";
import {ensureGitOnPath} from "./git.js";

ensureGitOnPath();
function payload(request:ToolRequest):Record<string,unknown>{return request.payload&&typeof request.payload==="object"&&!Array.isArray(request.payload)?request.payload as Record<string,unknown>:{};}
function workspaceFor(root:string,projectId?:string):string{
 if(!projectId)throw new Error("Project identity is required for workspace tools.");
 const safe=projectId.trim();
 if(!safe||safe==="."||safe===".."||safe.includes("/")||safe.includes("\\"))throw new Error("Invalid project workspace identity.");
 return resolve(root,safe);
}
function sandboxPath(root:string,input:string):string{
 if(!input||isAbsolute(input))throw new Error("Workspace paths must be relative.");
 const base=resolve(root),target=resolve(base,input),rel=relative(base,target);
 if(rel===""||(!rel.startsWith(".."+sep)&&rel!==".."))return target;
 throw new Error("Workspace path escapes the project sandbox.");
}
export function createFileToolAdapter(options:{root:string}):ToolAdapter{
 const root=resolve(options.root);
 return{async execute(request){
  const workspace=workspaceFor(root,request.projectId);await mkdir(workspace,{recursive:true});
  const input=payload(request),path=typeof input.path==="string"?input.path:"",target=sandboxPath(workspace,path);
  if(request.action==="list files"){const entries=await readdir(target,{withFileTypes:true});return{path,entries:entries.slice(0,200).map(entry=>({name:entry.name,type:entry.isDirectory()?"directory":"file"}))};}
  if(request.action==="stat file"){const info=await stat(target);return{path,type:info.isDirectory()?"directory":"file",size:info.size,modifiedAt:info.mtime.toISOString()};}
  if(request.action==="read file"){const info=await stat(target);if(!info.isFile())throw new Error("Target is not a file.");if(info.size>1024*1024)throw new Error("File exceeds the 1 MiB read limit.");return{path,content:await readFile(target,"utf8")};}
  throw new Error("Unsupported file action.");
 }};
}

export function createFileWriteToolAdapter(options:{root:string}):ToolAdapter{
 const root=resolve(options.root);
 return{async execute(request){
  const workspace=workspaceFor(root,request.projectId);await mkdir(workspace,{recursive:true});
  const input=payload(request),path=typeof input.path==="string"?input.path:"",content=typeof input.content==="string"?input.content:"";
  if(!path)throw new Error("File path is required.");
  if(content.length>2*1024*1024)throw new Error("File content exceeds the 2 MiB write limit.");
  const target=sandboxPath(workspace,path);
  if(request.action==="write file"||request.action==="modify file"){
   await mkdir(resolve(target,".."),{recursive:true});
   await writeFile(target,content,"utf8");
   return{path,bytes:Buffer.byteLength(content,"utf8"),written:true};
  }
  throw new Error("Unsupported file write action.");
 }};
}

function validateUrl(raw:string):URL{
 const url=new URL(raw);
 if(!["http:","https:"].includes(url.protocol))throw new Error("Browser supports HTTP(S) URLs only.");
 if(url.username||url.password)throw new Error("Browser URLs cannot contain credentials.");
 if(["localhost","127.0.0.1","::1"].includes(url.hostname)||url.hostname.endsWith(".localhost"))throw new Error("Local browser targets are blocked.");
 return url;
}
export function createBrowserToolAdapter(options:{fetcher?:typeof fetch}={}):ToolAdapter{
 const fetcher=options.fetcher??fetch;
 return{async execute(request){
  const input=payload(request),raw=typeof input.url==="string"?input.url:"",url=validateUrl(raw);
  const response=await fetcher(url,{method:"GET",redirect:"error",signal:AbortSignal.timeout(5000)});
  const body=await response.text();if(body.length>256*1024)throw new Error("Browser response exceeds the 256 KiB limit.");
  return{url:url.toString(),status:response.status,contentType:response.headers.get("content-type"),body};
 }};
}
const COMMANDS=new Map<string,string[]>([["git",["status","status --short","diff","log"]],["npm",["test","run typecheck","run build"]]]);
export function createTerminalToolAdapter(options:{root:string}):ToolAdapter{
 const root=resolve(options.root);
 return{async execute(request){
  const workspace=workspaceFor(root,request.projectId);await mkdir(workspace,{recursive:true});
  const input=payload(request),command=typeof input.command==="string"?input.command.trim():"",parts=command.split(/\s+/).filter(Boolean),binary=parts.shift()?.toLowerCase();
  if(!binary||!COMMANDS.has(binary))throw new Error("Terminal command is not allowed.");
  const allowed=COMMANDS.get(binary)??[],normalized=parts.join(" ").replace(/\s+/g," ").trim();
  const permitted=allowed.includes(normalized)||(binary==="git"&&normalized==="status");
  if(!permitted)throw new Error("Terminal command is not allowed.");
  if(/[;&|$<>]/.test(command)||command.includes(String.fromCharCode(96)))throw new Error("Shell metacharacters are blocked.");
  return await new Promise((resolvePromise,reject)=>{
   const executable=binary==="git"&&process.platform==="win32"?"git.exe":binary==="npm"&&process.platform==="win32"?(process.env.ComSpec??"cmd.exe"):binary;
   const executableArgs=binary==="npm"&&process.platform==="win32"?["/d","/s","/c",["npm.cmd",...parts].join(" ")]:parts;
   const child=spawn(executable,executableArgs,{cwd:workspace,shell:false,env:{...process.env,CI:"1"},timeout:30000});
   let stdout="",stderr="";
   child.stdout.on("data",chunk=>{stdout+=String(chunk);if(stdout.length>128*1024)child.kill("SIGKILL");});
   child.stderr.on("data",chunk=>{stderr+=String(chunk);if(stderr.length>128*1024)child.kill("SIGKILL");});
   child.on("error",reject);
   child.on("close",(code,signal)=>resolvePromise({command,cwd:workspace,exitCode:code,signal,stdout:stdout.slice(0,128*1024),stderr:stderr.slice(0,128*1024)}));
  });
 }};
}

export function createProjectVerifyToolAdapter(options:{root:string}):ToolAdapter{
 const root=resolve(options.root);
 const scripts=["test","typecheck","build"];
 return{async execute(request){
  const workspace=workspaceFor(root,request.projectId);await mkdir(workspace,{recursive:true});
  const input=payload(request),requested=typeof input.script==="string"?input.script.trim():"";
  if(!requested||!scripts.includes(requested))throw new Error("Verification script must be one of: test, typecheck, build.");
  const packagePath=resolve(workspace,"package.json");
  let packageData:Record<string,unknown>;
  try{packageData=JSON.parse(await readFile(packagePath,"utf8")) as Record<string,unknown>;}catch{throw new Error("Project package.json is required for verification.");}
  const packageScripts=packageData.scripts&&typeof packageData.scripts==="object"&&!Array.isArray(packageData.scripts)
    ?packageData.scripts as Record<string,unknown>:{};
  if(typeof packageScripts[requested]!=="string")throw new Error("Project does not define the requested verification script.");
  return await new Promise((resolvePromise,reject)=>{
   const isWindows=process.platform==="win32";
   const binary=isWindows?(process.env.ComSpec??"cmd.exe"):"npm";
   const commandArgs=isWindows?["/d","/s","/c",`npm.cmd run ${requested}`]:["run",requested];
   const child=spawn(binary,commandArgs,{cwd:workspace,shell:false,env:{...process.env,CI:"1"},timeout:60000});
   let stdout="",stderr="";
   child.stdout.on("data",chunk=>{stdout+=String(chunk);if(stdout.length>128*1024)child.kill("SIGKILL");});
   child.stderr.on("data",chunk=>{stderr+=String(chunk);if(stderr.length>128*1024)child.kill("SIGKILL");});
   child.on("error",reject);
   child.on("close",(code,signal)=>resolvePromise({script:requested,cwd:workspace,exitCode:code,signal,passed:code===0,stdout:stdout.slice(0,128*1024),stderr:stderr.slice(0,128*1024)}));
  });
 }};
}


function validatePackageName(value:string):boolean{
  return /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+(?:@[a-z0-9._*^~<>=+ -]+)?$/i.test(value)
    && !value.includes("://")
    && !value.includes("\\\\")
    && !/[;&|$\`<>]/.test(value)
    && !value.startsWith("-");
}
function runNpm(cwd:string,args:string[],timeoutMs:number):Promise<{args:string[];cwd:string;exitCode:number|null;signal:NodeJS.Signals|null;stdout:string;stderr:string}>{
  return new Promise((resolvePromise,reject)=>{
    const isWindows=process.platform==="win32";
    const binary=isWindows?(process.env.ComSpec??"cmd.exe"):"npm";
    const commandArgs=isWindows?["/d","/s","/c",`npm.cmd ${args.join(" ")}`]:args;
    const child=spawn(binary,commandArgs,{cwd,shell:false,env:{...process.env,CI:"1"},timeout:timeoutMs});
    let stdout="",stderr="";
    child.stdout.on("data",chunk=>{stdout+=String(chunk);if(stdout.length>128*1024)child.kill("SIGKILL");});
    child.stderr.on("data",chunk=>{stderr+=String(chunk);if(stderr.length>128*1024)child.kill("SIGKILL");});
    child.on("error",reject);
    child.on("close",(code,signal)=>resolvePromise({args,cwd,exitCode:code,signal,stdout:stdout.slice(0,128*1024),stderr:stderr.slice(0,128*1024)}));
  });
}
export function createProjectBootstrapToolAdapter(options:{root:string}):ToolAdapter{
  const root=resolve(options.root);
  return{async execute(request){
    const workspace=workspaceFor(root,request.projectId);
    await mkdir(workspace,{recursive:true});
    if(request.action!=="bootstrap project")throw new Error("Unsupported project bootstrap action.");
    const input=payload(request);
    const dependencies=Array.isArray(input.dependencies)?input.dependencies.filter((v):v is string=>typeof v==="string").map(v=>v.trim()).filter(Boolean):[];
    const devDependencies=Array.isArray(input.devDependencies)?input.devDependencies.filter((v):v is string=>typeof v==="string").map(v=>v.trim()).filter(Boolean):[];
    if(dependencies.length>20||devDependencies.length>20)throw new Error("A maximum of 20 runtime and 20 development dependencies is allowed per bootstrap.");
    if([...dependencies,...devDependencies].some(value=>!validatePackageName(value)))throw new Error("Invalid npm package name.");
    const results:unknown[]=[];
    try{
      await stat(resolve(workspace,"package.json"));
    }catch{
      results.push(await runNpm(workspace,["init","-y"],30000));
    }
    if(dependencies.length)results.push(await runNpm(workspace,["install",...dependencies],120000));
    if(devDependencies.length)results.push(await runNpm(workspace,["install","--save-dev",...devDependencies],120000));
    const failed=results.find(result=>typeof result==="object"&&result!==null&&"exitCode" in result&&(result as {exitCode:number|null}).exitCode!==0) as {exitCode:number|null}|undefined;
    return{projectId:request.projectId,workspace,initialized:results.length>0,dependencies,devDependencies,passed:!failed,results};
  }};
}
