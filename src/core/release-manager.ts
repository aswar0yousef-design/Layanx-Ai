import {resolve} from "node:path";
import {spawn} from "node:child_process";
import type {ReleaseRecord} from "./release-state-machine.js";
import type {PullRequestDraft} from "./pr-generator.js";

export interface ReleasePreparation{
 release:ReleaseRecord;
 ready:boolean;
 blockers:string[];
}

export class ReleaseManager{
 constructor(private readonly root=process.env.LAYANX_WORKSPACE_ROOT??process.cwd()){}

 async prepare(record:ReleaseRecord,pr:PullRequestDraft):Promise<ReleasePreparation>{
  const blockers=[...record.blockers];
  if(!pr.ready)blockers.push(...pr.blockers);
  const branch=(await this.git(["branch","--show-current"])).trim();
  const commit=(await this.git(["rev-parse","HEAD"])).trim();
  if(branch!==record.branch)blockers.push("Release branch does not match current branch.");
  if(commit!==record.commit)blockers.push("Release commit does not match current HEAD.");
  if(record.stage!=="PR_READY"&&record.stage!=="HUMAN_APPROVAL")blockers.push("Release preparation requires PR_READY or HUMAN_APPROVAL state.");
  return{release:record,ready:blockers.length===0,blockers};
 }

 async currentVersion(){
  try{
   const raw=await import("node:fs/promises").then(fs=>fs.readFile(resolve(this.root,"package.json"),"utf8"));
   const parsed=JSON.parse(raw) as {version?:unknown};
   return typeof parsed.version==="string"?parsed.version:"0.0.0";
  }catch{return"0.0.0";}
 }

 private async git(args:string[]):Promise<string>{
  return await new Promise((resolveResult,reject)=>{
   const child=spawn("git",args,{cwd:resolve(this.root),shell:false,windowsHide:true});
   let stdout="",stderr="";
   child.stdout?.on("data",chunk=>stdout+=String(chunk).slice(0,65536));
   child.stderr?.on("data",chunk=>stderr+=String(chunk).slice(0,65536));
   child.on("error",reject);
   child.on("close",code=>code===0?resolveResult(stdout):reject(new Error(stderr.trim()||"Git command failed.")));
  });
 }
}
