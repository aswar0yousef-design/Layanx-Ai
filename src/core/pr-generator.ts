import {resolve} from "node:path";
import {spawn} from "node:child_process";
import type {CodeReviewResult} from "./code-review-agent.js";
import type {SecurityReviewResult} from "./security-review-agent.js";
export interface PullRequestOptions{missionId:string;projectId:string;baseBranch:string;title:string;goal:string;codeReview:CodeReviewResult;securityReview:SecurityReviewResult;}
export interface PullRequestDraft{ready:boolean;branch:string;baseBranch:string;title:string;body:string;commit:string;files:string[];blockers:string[];}
export class PullRequestGenerator{
constructor(private readonly root=process.env.LAYANX_WORKSPACE_ROOT??process.cwd()){}
async generate(options:PullRequestOptions):Promise<PullRequestDraft>{
const baseRef=await this.resolveBaseRef(options.baseBranch);
const [branch,commit,filesText]=await Promise.all([this.git(["branch","--show-current"]),this.git(["rev-parse","HEAD"]),this.git(["diff","--name-only",baseRef+"...HEAD"])]);
const currentBranch=branch.trim(),commitSha=commit.trim(),files=filesText.split("\n").filter(Boolean),blockers:string[]=[];
if(!currentBranch)blockers.push("No active Git branch.");
if(currentBranch===options.baseBranch)blockers.push("Pull requests require a head branch different from the base branch.");
if(!options.codeReview.approved)blockers.push("Code review gate is not approved.");
if(!options.securityReview.approved)blockers.push("Security review gate is not approved.");
if(options.codeReview.commit!==commitSha)blockers.push("Code review does not match the current HEAD commit.");
if(options.securityReview.commit!==commitSha)blockers.push("Security review does not match the current HEAD commit.");
if(options.codeReview.branch!==currentBranch)blockers.push("Code review branch does not match the current branch.");
if(options.securityReview.branch!==currentBranch)blockers.push("Security review branch does not match the current branch.");
if(!files.length)blockers.push("No changes exist between the base branch and HEAD.");
const body=["## Summary",options.goal.trim(),"","## Mission","- Mission: "+options.missionId,"- Project: "+options.projectId,"- Head: "+currentBranch,"- Base: "+options.baseBranch,"- Commit: "+commitSha,"","## Changed files",...files.map(file=>"- `"+file+"`"),"","## Validation","- Code review: "+(options.codeReview.approved?"approved":"blocked"),"- Security review: "+(options.securityReview.approved?"approved":"blocked"),"","## Security","No automatic merge or release is performed by the PR generator."].join("\n");
return{ready:blockers.length===0,branch:currentBranch,baseBranch:options.baseBranch,title:this.normalizeTitle(options.title),body,commit:commitSha,files,blockers};
}
private async resolveBaseRef(baseBranch:string):Promise<string>{
 try{await this.git(["rev-parse","--verify",baseBranch]);return baseBranch;}catch{
  const remote="origin/"+baseBranch;
  await this.git(["rev-parse","--verify",remote]);return remote;
 }
}
private normalizeTitle(title:string){const value=title.trim().replace(/[\r\n]+/g," ");if(!value||value.length>150)throw new Error("Pull request title is required and must be at most 150 characters.");return value;}
private async git(args:string[]):Promise<string>{return await new Promise((resolveResult,reject)=>{const child=spawn("git",args,{cwd:resolve(this.root),shell:false,windowsHide:true});let stdout="",stderr="";child.stdout?.on("data",chunk=>stdout+=String(chunk).slice(0,262144));child.stderr?.on("data",chunk=>stderr+=String(chunk).slice(0,65536));child.on("error",reject);child.on("close",code=>code===0?resolveResult(stdout):reject(new Error(stderr.trim()||"Git command failed.")));});}
}
