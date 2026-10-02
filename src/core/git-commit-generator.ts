import {spawn} from "node:child_process";
import {resolve} from "node:path";

export interface GitCommitOptions{
  missionId:string;
  projectId:string;
  message:string;
  expectedBranch?:string;
  paths?:string[];
  requireCleanAfterCommit?:boolean;
}

export interface GitCommitResult{
  committed:boolean;
  branch:string;
  commit?:string;
  files:string[];
  message:string;
}

export class GitCommitGenerator{
  constructor(private readonly root=process.env.LAYANX_WORKSPACE_ROOT??process.cwd()){}

  async commit(options:GitCommitOptions):Promise<GitCommitResult>{
    const root=resolve(this.root);
    const branch=await this.run(root,["branch","--show-current"]);
    const currentBranch=branch.stdout.trim();
    if(!currentBranch)throw new Error("Git is not currently on a branch.");
    if(options.expectedBranch&&currentBranch!==options.expectedBranch)throw new Error("Current branch does not match the expected mission branch.");
    const status=await this.run(root,["status","--porcelain"]);
    const lines=status.stdout.split("\n").map(line=>line.trimEnd()).filter(Boolean);
    if(!lines.length)return{committed:false,branch:currentBranch,files:[],message:options.message};
    const files=lines.map(line=>line.length>3?line.slice(3).trim():line).filter(Boolean);
    const selected=options.paths?.map(path=>path.trim()).filter(Boolean);
    const unexpected=selected?files.filter(file=>!selected.includes(file)):[];

    if(selected&&unexpected.length)throw new Error("Working tree contains changes outside the requested commit scope: "+unexpected.join(", "));
    const message=this.normalizeMessage(options.message);
    const addArgs=["add","--"];
    if(selected?.length)addArgs.push(...selected);
    else addArgs.push(...files);
    await this.run(root,addArgs);
    const staged=(await this.run(root,["diff","--cached","--name-only"])).stdout.split("\n").filter(Boolean);
    if(!staged.length)throw new Error("No changes were staged for commit.");
    await this.run(root,["commit","-m",message]);
    const commit=(await this.run(root,["rev-parse","HEAD"])).stdout.trim();
    if(options.requireCleanAfterCommit!==false){
      const after=await this.run(root,["status","--porcelain"]);
      if(after.stdout.trim())throw new Error("Commit completed but the working tree is not clean.");
    }
    return{committed:true,branch:currentBranch,commit,files:staged,message};
  }

  private normalizeMessage(message:string){
    const value=message.trim().replace(/[\r\n]+/g," ");
    if(!value||value.length>200)throw new Error("Commit message is required and must be at most 200 characters.");
    if(/^(fixup!|squash!)/i.test(value))throw new Error("Fixup and squash commits are not allowed in autonomous commit generation.");
    return value;
  }

  private async run(cwd:string,args:string[]):Promise<{stdout:string;stderr:string;exitCode:number}>{
    return await new Promise((resolveResult,reject)=>{
      const child=spawn("git",args,{cwd,shell:false,windowsHide:true});
      let stdout="",stderr="";
      child.stdout?.on("data",chunk=>stdout+=String(chunk).slice(0,65536));
      child.stderr?.on("data",chunk=>stderr+=String(chunk).slice(0,65536));
      child.on("error",reject);
      child.on("close",exitCode=>{
        const result={stdout,stderr,exitCode:exitCode??-1};
        if(result.exitCode!==0)reject(new Error(result.stderr.trim()||"Git command failed."));
        else resolveResult(result);
      });
    });
  }
}
