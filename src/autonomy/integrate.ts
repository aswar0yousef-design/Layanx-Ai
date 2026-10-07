import {execFile} from "node:child_process";
import type {ToolAdapter} from "../tools/executor.js";
import type {ToolRequest} from "../core/types.js";
import {safeChildEnv} from "../platform/safe-env.js";
import {assertSafeGitRef} from "../platform/git-ref.js";
import {projectDir} from "./project-dir.js";

/**
 * Bringing a job's work branch home:
 *   git.merge       merge a branch into main/master locally (--no-ff, aborts cleanly on conflicts)
 *   git.publish_pr  push the branch and open a GitHub pull request (or return the compare link)
 * Both are dangerous: merge runs alone only at "full" trust, publishing ALWAYS waits for the owner.
 */
function git(cwd:string,args:string[],timeout=60_000):Promise<{code:number;stdout:string;stderr:string}>{
  return new Promise(resolve=>execFile("git",args,{cwd,windowsHide:true,timeout,maxBuffer:4*1024*1024,
    env:safeChildEnv({allow:["HOME","GIT_SSH","GIT_SSH_COMMAND","SSH_AUTH_SOCK","GCM_INTERACTIVE"],extra:{GIT_TERMINAL_PROMPT:"0"}})},
    (e,stdout,stderr)=>resolve({code:e?(typeof (e as {code?:unknown}).code==="number"?(e as {code:number}).code:1):0,stdout:String(stdout),stderr:String(stderr)})));
}
export async function defaultBranch(dir:string):Promise<string>{
  for(const b of ["main","master"])if((await git(dir,["rev-parse","--verify","--quiet","refs/heads/"+b])).code===0)return b;
  throw new Error("No main or master branch in this repository.");
}
export async function pendingBranches(dir:string):Promise<Array<{branch:string;ahead:number;last:string}>>{
  let base:string;try{base=await defaultBranch(dir);}catch{return[];}
  const r=await git(dir,["branch","--no-merged",base,"--format=%(refname:short)"]);
  const out:Array<{branch:string;ahead:number;last:string}>=[];
  for(const b of r.stdout.split("\n").map(x=>x.trim()).filter(x=>x.startsWith("layanx/")).slice(0,20)){
    const ahead=Number((await git(dir,["rev-list","--count",`${base}..${b}`])).stdout.trim())||0;
    const last=(await git(dir,["log","-1","--pretty=%s",b])).stdout.trim();
    out.push({branch:b,ahead,last});
  }
  return out;
}
function branchArg(v:unknown):string{
  const b=typeof v==="string"?v.trim():"";
  assertSafeGitRef(b);
  if(!/^[\w./-]+$/.test(b))throw new Error("Invalid branch name.");
  return b;
}

export function createMergeAdapter():ToolAdapter{
  return{async execute(request:ToolRequest){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const dir=projectDir(request.projectId);
    const branch=branchArg(input.branch);
    const into=input.into?branchArg(input.into):await defaultBranch(dir);
    if(branch===into)throw new Error("Cannot merge a branch into itself.");
    if((await git(dir,["rev-parse","--verify","--quiet","refs/heads/"+branch])).code!==0)throw new Error(`Branch ${branch} does not exist.`);
    if((await git(dir,["status","--porcelain"])).stdout.trim())throw new Error("There are uncommitted changes; commit or stash them before merging.");
    const current=(await git(dir,["rev-parse","--abbrev-ref","HEAD"])).stdout.trim();
    const co=await git(dir,["checkout",into]);
    if(co.code!==0)throw new Error("Could not switch to "+into+": "+co.stderr.slice(0,300));
    const m=await git(dir,["merge","--no-ff",branch,"-m",`LayanX: merge ${branch}`],120_000);
    if(m.code!==0){
      await git(dir,["merge","--abort"]);
      if(current&&current!==into)await git(dir,["checkout",current]);
      return{merged:false,conflict:true,branch,into,message:"Merge conflict; nothing was changed. Ask LayanX to resolve the conflicts on the branch first.",detail:(m.stdout+m.stderr).slice(0,1500)};
    }
    const commit=(await git(dir,["rev-parse","--short","HEAD"])).stdout.trim();
    return{merged:true,branch,into,commit};
  }};
}

export function githubRepo(remoteUrl:string):{owner:string;repo:string}|null{
  const m=/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return m?{owner:m[1]!,repo:m[2]!}:null;
}

export function createPublishPrAdapter(fetcher:typeof fetch=fetch):ToolAdapter{
  return{async execute(request:ToolRequest){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const dir=projectDir(request.projectId);
    const branch=branchArg(input.branch);
    const base=input.base?branchArg(input.base):await defaultBranch(dir);
    const remote=(await git(dir,["remote","get-url","origin"])).stdout.trim();
    if(!remote)throw new Error("This repository has no 'origin' remote.");
    const push=await git(dir,["push","-u","origin",branch],180_000);
    if(push.code!==0)throw new Error("git push failed: "+(push.stderr||push.stdout).slice(0,500));
    const gh=githubRepo(remote);
    if(!gh)return{pushed:true,branch,remote,pr:null,message:"Pushed. The remote is not GitHub; open the review request there."};
    const compare=`https://github.com/${gh.owner}/${gh.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1`;
    const token=process.env.GITHUB_TOKEN?.trim();
    if(!token)return{pushed:true,branch,pr:null,url:compare,message:"Pushed. Add GITHUB_TOKEN to let LayanX open the pull request itself; for now open the link."};
    const title=typeof input.title==="string"&&input.title.trim()?input.title.trim().slice(0,200):`LayanX: ${branch}`;
    const body=typeof input.body==="string"?input.body.slice(0,20000):"Opened by LayanX after its own tests, build, browser and security checks.";
    const r=await fetcher(`https://api.github.com/repos/${gh.owner}/${gh.repo}/pulls`,{method:"POST",headers:{authorization:`Bearer ${token}`,accept:"application/vnd.github+json","content-type":"application/json","user-agent":"LayanX"},body:JSON.stringify({title,head:branch,base,body})});
    const data=await r.json().catch(()=>({})) as {html_url?:string;number?:number;message?:string};
    if(!r.ok)return{pushed:true,branch,pr:null,url:compare,message:`GitHub refused the pull request (${r.status}): ${data.message??""}`.trim()};
    return{pushed:true,branch,pr:{number:data.number,url:data.html_url}};
  }};
}
