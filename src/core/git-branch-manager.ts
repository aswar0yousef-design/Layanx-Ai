import {spawn} from "node:child_process";
import {gitSafetyArgs} from "../platform/windows-sandbox.js";
import {resolve} from "node:path";

export interface GitBranchManagerOptions{root:string;}
export interface GitCommandResult{stdout:string;stderr:string;exitCode:number;}
export interface BranchStatus{branch:string;clean:boolean;changes:string[];}

export class GitBranchManager{
  private readonly root:string;
  constructor(options:GitBranchManagerOptions){this.root=resolve(options.root);}
  async status():Promise<BranchStatus>{
    const detected=(await this.git(["branch","--show-current"])).stdout.trim();
    // CI checkouts are detached; only there is the runner-provided branch name trusted. Locally a detached HEAD stays "".
    const branch=detected||(process.env.GITHUB_ACTIONS==="true"?(process.env.GITHUB_HEAD_REF?.trim()||process.env.GITHUB_REF_NAME?.trim()||""):"");
    const porcelain=(await this.git(["status","--porcelain"])).stdout.trim();
    return{branch,clean:!porcelain,changes:porcelain?porcelain.split("\n").filter(Boolean):[]};
  }
  async createBranch(branchName:string,baseRef?:string,requireClean=true){
    this.validateBranch(branchName);
    const current=await this.status();
    if(requireClean&&!current.clean)throw new Error("Working tree must be clean before creating an autonomous branch.");
    const args=["switch","-c",branchName];
    if(baseRef?.trim())args.push(baseRef.trim());
    await this.git(args);
    return this.status();
  }
  async switchBranch(branchName:string,requireClean=true){
    this.validateBranch(branchName);
    const current=await this.status();
    if(requireClean&&!current.clean)throw new Error("Working tree must be clean before switching branches.");
    await this.git(["switch",branchName]);
    return this.status();
  }
  async currentCommit(){return(await this.git(["rev-parse","HEAD"])).stdout.trim();}
  async diffNameOnly(baseRef="HEAD~1"){
    return(await this.git(["diff","--name-only",baseRef,"HEAD"])).stdout.split("\n").filter(Boolean);
  }
  async branchExists(branchName:string){
    this.validateBranch(branchName);
    const result=await this.git(["show-ref","--verify","--quiet","refs/heads/"+branchName],true);
    return result.exitCode===0;
  }
  private validateBranch(name:string){
    const value=name.trim();
    if(!value||value.length>200||/[\s~^:?*\[\\]/.test(value)||value.startsWith("-")||value.endsWith(".")||value.endsWith(".lock")||value.includes("..")||value.includes("@{"))
      throw new Error("Invalid Git branch name.");
  }
  private async git(args:string[],allowFailure=false):Promise<GitCommandResult>{
    return await new Promise((resolveResult,reject)=>{
      const child=spawn("git",[...gitSafetyArgs(this.root),...args],{cwd:this.root,shell:false,windowsHide:true});
      let stdout="",stderr="";
      child.stdout?.on("data",chunk=>stdout+=String(chunk).slice(0,65536));
      child.stderr?.on("data",chunk=>stderr+=String(chunk).slice(0,65536));
      child.on("error",error=>reject(error));
      child.on("close",(exitCode)=>{
        const result={stdout,stderr,exitCode:exitCode??-1};
        if(result.exitCode!==0&&!allowFailure)reject(new Error(stderr.trim()||"Git command failed."));
        else resolveResult(result);
      });
    });
  }
}
