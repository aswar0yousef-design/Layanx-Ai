import {readFile,readdir,stat,mkdir} from "node:fs/promises";
import {resolve,relative,isAbsolute,sep} from "node:path";
import {spawn} from "node:child_process";
import type {ToolRequest} from "../core/types.js";
import type {ToolAdapter} from "./executor.js";
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
const COMMANDS=new Map<string,string[]>([["git",["status","diff","log"]],["npm",["test","run typecheck","run build"]]]);
export function createTerminalToolAdapter(options:{root:string}):ToolAdapter{
 const root=resolve(options.root);
 return{async execute(request){
  const workspace=workspaceFor(root,request.projectId);await mkdir(workspace,{recursive:true});
  const input=payload(request),command=typeof input.command==="string"?input.command.trim():"",parts=command.split(/\s+/).filter(Boolean),binary=parts.shift();
  if(!binary||!COMMANDS.has(binary))throw new Error("Terminal command is not allowed.");
  const allowed=COMMANDS.get(binary)??[],normalized=parts.join(" ");
  if(!allowed.some(prefix=>normalized===prefix||normalized.startsWith(prefix+" ")))throw new Error("Terminal command is not allowed.");
  if(/[;&|$<>]/.test(command)||command.includes(String.fromCharCode(96)))throw new Error("Shell metacharacters are blocked.");
  return await new Promise((resolvePromise,reject)=>{
   const child=spawn(binary,parts,{cwd:workspace,shell:false,env:{...process.env,CI:"1"},timeout:30000});
   let stdout="",stderr="";
   child.stdout.on("data",chunk=>{stdout+=String(chunk);if(stdout.length>128*1024)child.kill("SIGKILL");});
   child.stderr.on("data",chunk=>{stderr+=String(chunk);if(stderr.length>128*1024)child.kill("SIGKILL");});
   child.on("error",reject);
   child.on("close",(code,signal)=>resolvePromise({command,cwd:workspace,exitCode:code,signal,stdout:stdout.slice(0,128*1024),stderr:stderr.slice(0,128*1024)}));
  });
 }};
}
