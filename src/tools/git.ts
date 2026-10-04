import {mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import {resolve,relative,sep} from "node:path";

export function ensureGitOnPath():void{
 if(process.platform!=="win32")return;
 const pathEntries=(process.env.PATH??"").split(";").filter(Boolean);
 for(const candidate of ["C:\\Program Files\\Git\\cmd","C:\\Program Files\\Git\\bin","C:\\Program Files (x86)\\Git\\cmd"])
  if(existsSync(candidate)&&!pathEntries.some(entry=>entry.toLowerCase()===candidate.toLowerCase()))pathEntries.push(candidate);
 process.env.PATH=pathEntries.join(";");
}
ensureGitOnPath();
import {spawn} from "node:child_process";
import type {ToolRequest} from "../core/types.js";
import type {ToolAdapter} from "./executor.js";

function payload(request:ToolRequest):Record<string,unknown>{return request.payload&&typeof request.payload==="object"&&!Array.isArray(request.payload)?request.payload as Record<string,unknown>:{};}
function workspaceFor(root:string,projectId:string):string{
 const safe=projectId.trim();
 if(!safe||safe==="."||safe===".."||safe.includes("/")||safe.includes("\\"))throw new Error("Invalid project workspace identity.");
 return resolve(root,safe);
}
function run(cwd:string,args:string[],timeout=30000):Promise<unknown>{
 return new Promise((resolvePromise,reject)=>{
  const isWindows=process.platform==="win32";
  const binary=isWindows?(process.env.ComSpec??"cmd.exe"):"git";
  const commandArgs=isWindows?["/d","/s","/c",["git",...args].map(value=>`"${value.replace(/"/g,'""')}"`).join(" ")]:args;
  const child=spawn(binary,commandArgs,{cwd,shell:false,env:{...process.env,GIT_TERMINAL_PROMPT:"0"},timeout});
  let stdout="",stderr="";
  child.stdout.on("data",c=>{stdout+=String(c);if(stdout.length>128*1024)child.kill("SIGKILL");});
  child.stderr.on("data",c=>{stderr+=String(c);if(stderr.length>128*1024)child.kill("SIGKILL");});
  child.on("error",reject);
  child.on("close",(code,signal)=>resolvePromise({command:["git",...args].join(" "),cwd,exitCode:code,signal,stdout:stdout.slice(0,128*1024),stderr:stderr.slice(0,128*1024)}));
 });
}
function safePath(value:unknown,cwd:string):string{
 const p=typeof value==="string"?value.trim():"";
 if(!p||p.startsWith("-")||p.includes("\0"))throw new Error("Invalid Git path.");
 const target=resolve(cwd,p),rel=relative(cwd,target);
 if(rel===".."||rel.startsWith(".."+sep)||rel.includes("\0"))throw new Error("Git path escapes the project workspace.");
 return p;
}
export function createGitToolAdapter(options:{root:string}):ToolAdapter{
 const root=resolve(options.root);
 return{async execute(request:ToolRequest){
  const workspace=workspaceFor(root,typeof request.projectId==="string"?request.projectId:"");await mkdir(workspace,{recursive:true});
  const input=payload(request);
  switch(request.action){
   case "git status": return run(workspace,["status","--short"]);
   case "git checkpoint": { const result=await run(workspace,["rev-parse","HEAD"]) as {stdout:string;exitCode:number|null}; return {...result,stdout:result.stdout.trim()+"\n"}; }
   case "git branch": {
    const branch=typeof input.branch==="string"?input.branch.trim():"";
    if(!/^[A-Za-z0-9._/-]+$/.test(branch)||branch.startsWith("-")||branch.includes("..")||branch.includes("//"))throw new Error("Invalid Git branch name.");
    if(branch==="main"||branch==="master"||branch.startsWith("main/")||branch.startsWith("master/"))throw new Error("Protected branch name cannot be created by the agent.");
    return run(workspace,["switch","-c",branch]);
   }
   case "git diff": return run(workspace,["diff","--"]);
   case "git log": return run(workspace,["log","-n","20","--oneline","--decorate"]);
   case "git add": return run(workspace,["add","--",safePath(input.path,workspace)]);
   case "git commit":{
    const message=typeof input.message==="string"?input.message.trim():"";
    if(!message||message.length>200)throw new Error("Commit message is required and must be <= 200 characters.");
    return run(workspace,["commit","-m",message]);
   }
   case "git rollback": {
    const sha=typeof input.commit==="string"?input.commit.trim():"";
    if(!/^[0-9a-fA-F]{40}$/.test(sha))throw new Error("Rollback requires an exact 40-character commit SHA.");
    const current=await run(workspace,["branch","--show-current"]) as {stdout?:string};
    const branch=(current.stdout??"").trim();
    if(branch==="main"||branch==="master")throw new Error("Rollback on protected main/master branches is blocked.");
    return run(workspace,["reset","--hard",sha]);
   }
   case "git push":{
    const remote=typeof input.remote==="string"&&input.remote.trim()?input.remote.trim():"origin";
    const branch=typeof input.branch==="string"?input.branch.trim():"";
    if(!/^[A-Za-z0-9._-]+$/.test(remote)||remote.startsWith("-"))throw new Error("Invalid Git remote.");
    if(!branch||!/^[A-Za-z0-9._\/-]+$/.test(branch)||branch.startsWith("-")||branch.includes(".."))throw new Error("Invalid Git branch.");
    if((branch==="main"||branch==="master")&&process.env.LAYANX_ALLOW_MAIN_PUSH!=="true")throw new Error("Pushing to main/master is disabled unless LAYANX_ALLOW_MAIN_PUSH=true.");
    return run(workspace,["push",remote,"HEAD:"+branch],60000);
   }
   default: throw new Error("Unsupported Git action.");
  }
 }};
}
