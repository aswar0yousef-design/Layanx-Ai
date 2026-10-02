import {mkdir} from "node:fs/promises";
import {resolve} from "node:path";
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
  const child=spawn("git",args,{cwd,shell:false,env:{...process.env,GIT_TERMINAL_PROMPT:"0"},timeout});
  let stdout="",stderr="";
  child.stdout.on("data",c=>{stdout+=String(c);if(stdout.length>128*1024)child.kill("SIGKILL");});
  child.stderr.on("data",c=>{stderr+=String(c);if(stderr.length>128*1024)child.kill("SIGKILL");});
  child.on("error",reject);
  child.on("close",(code,signal)=>resolvePromise({command:["git",...args].join(" "),cwd,exitCode:code,signal,stdout:stdout.slice(0,128*1024),stderr:stderr.slice(0,128*1024)}));
 });
}
function safePath(value:unknown):string{
 const p=typeof value==="string"?value.trim():"";
 if(!p||p.startsWith("-")||p.includes("\0"))throw new Error("Invalid Git path.");
 return p;
}
export function createGitToolAdapter(options:{root:string}):ToolAdapter{
 const root=resolve(options.root);
 return{async execute(request:ToolRequest){
  const workspace=workspaceFor(root,request.projectId);await mkdir(workspace,{recursive:true});
  const input=payload(request);
  switch(request.action){
   case "git status": return run(workspace,["status","--short"]);
   case "git diff": return run(workspace,["diff","--"]);
   case "git log": return run(workspace,["log","-n","20","--oneline","--decorate"]);
   case "git add": return run(workspace,["add","--",safePath(input.path)]);
   case "git commit":{
    const message=typeof input.message==="string"?input.message.trim():"";
    if(!message||message.length>200)throw new Error("Commit message is required and must be <= 200 characters.");
    return run(workspace,["commit","-m",message]);
   }
   case "git push":{
    const remote=typeof input.remote==="string"&&input.remote.trim()?input.remote.trim():"origin";
    const branch=typeof input.branch==="string"&&input.branch.trim()?input.branch.trim():"";
    if(!/^[A-Za-z0-9._-]+$/.test(remote)||remote.startsWith("-"))throw new Error("Invalid Git remote.");
    if(!branch||!/^[A-Za-z0-9._\/-]+$/.test(branch)||branch.startsWith("-")||branch.includes(".."))throw new Error("Invalid Git branch.");
    return run(workspace,["push",remote,"HEAD:"+branch],60000);
   }
   default: throw new Error("Unsupported Git action.");
  }
 }};
}
