import {safeChildEnv} from "../platform/safe-env.js";
import {gitSafetyArgs} from "../platform/windows-sandbox.js";
import {mkdir} from "node:fs/promises";
import {existsSync} from "node:fs";
import {resolve,relative,sep,dirname} from "node:path";
import {execFileSync} from "node:child_process";
import {spawn} from "node:child_process";
import type {ToolRequest} from "../core/types.js";
import type {ToolAdapter} from "./executor.js";
import {ProjectIsolation} from "../security/project-isolation.js";

export function ensureGitOnPath():void{
 if(process.platform!=="win32")return;
 const current=process.env.PATH??"";
 const entries=current.split(";").filter(Boolean);
 const hasGit=entries.some(entry=>entry.toLowerCase()==="c:\\program files\\git\\cmd"||entry.toLowerCase()==="c:\\program files\\git\\bin");
 if(hasGit)return;
 try{
  const located=execFileSync((process.env.SystemRoot??"C:\\Windows")+"\\System32\\where.exe",["git.exe"],{encoding:"utf8",windowsHide:true}).split(/\r?\n/).map(value=>value.trim()).filter(Boolean)[0];
  if(located){
   const dir=dirname(located);
   if(existsSync(dir))process.env.PATH=dir+";"+current;
  }
 }catch{}
}
ensureGitOnPath();

function payload(request:ToolRequest):Record<string,unknown>{return request.payload&&typeof request.payload==="object"&&!Array.isArray(request.payload)?request.payload as Record<string,unknown>:{};}
const projectIsolation=new ProjectIsolation();
function workspaceFor(root:string,projectId:string):string{
 return projectIsolation.workspacePath(root,projectId);
}
function run(cwd:string,args:string[],timeout=30000):Promise<unknown>{
 return new Promise((resolvePromise,reject)=>{
  const isWindows=process.platform==="win32";
  const binary=isWindows?"git.exe":"git";
  const commandArgs=[...gitSafetyArgs(cwd),...args];
  const child=spawn(binary,commandArgs,{cwd,shell:false,env:safeChildEnv({allow:["HOME","GIT_SSH","GIT_SSH_COMMAND","SSH_AUTH_SOCK","GCM_INTERACTIVE"],extra:{GIT_TERMINAL_PROMPT:"0"}}),timeout});
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
   case "git status": return run(workspace,["status","--short","--branch"]);
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
