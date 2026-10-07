import {readFile} from "node:fs/promises";
import {gitSafetyArgs} from "../platform/windows-sandbox.js";
import {resolve} from "node:path";
import {spawn} from "node:child_process";

export interface ReviewFinding{
  severity:"info"|"low"|"medium"|"high"|"critical";
  category:"security"|"correctness"|"scope"|"testing"|"maintainability";
  message:string;
  path?:string;
}

export interface CodeReviewResult{
  branch:string;
  commit:string;
  files:string[];
  findings:ReviewFinding[];
  approved:boolean;
}

export class CodeReviewAgent{
  constructor(private readonly root=process.env.LAYANX_WORKSPACE_ROOT??process.cwd()){}

  async review(baseRef="HEAD~1"):Promise<CodeReviewResult>{
    const branch=await this.git(["branch","--show-current"]);
    const commit=await this.git(["rev-parse","HEAD"]);
    const files=(await this.git(["diff","--name-only",baseRef,"HEAD"])).split("\n").filter(Boolean);
    const diff=await this.git(["diff","--no-ext-diff","--unified=0",baseRef,"HEAD"]);
    const findings:ReviewFinding[]=[];
    const secretPatterns=[
      /(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*["'][^"']{8,}["']/i,
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
      /sk-[A-Za-z0-9_-]{20,}/
    ];
    for(const pattern of secretPatterns)if(pattern.test(diff))findings.push({severity:"critical",category:"security",message:"Potential credential or private key detected in the change set."});
    if(/\beval\s*\(/.test(diff))findings.push({severity:"high",category:"security",message:"Use of eval() detected in the change set."});
    if(/child_process.*shell\s*:\s*true|exec\s*\(/.test(diff))findings.push({severity:"high",category:"security",message:"Potential shell command execution detected; review input boundaries."});
    for(const file of files){
      if(/\.(spec|test)\./i.test(file))continue;
      const source=await this.readIfText(file);
      if(source===null)continue;
      if(/TODO|FIXME/.test(source))findings.push({severity:"info",category:"maintainability",message:"TODO/FIXME marker present in changed file.",path:file});
    }
    if(!files.some(file=>/\.(spec|test)\./i.test(file)))findings.push({severity:"medium",category:"testing",message:"No test file changed in this commit; verify coverage is sufficient."});
    const approved=!findings.some(f=>["high","critical"].includes(f.severity));
    return{branch:branch.trim(),commit:commit.trim(),files,findings,approved};
  }

  private async readIfText(path:string):Promise<string|null>{
    try{return await readFile(resolve(this.root,path),"utf8");}catch{return null;}
  }
  private async git(args:string[]):Promise<string>{
    return await new Promise((resolveResult,reject)=>{
      const child=spawn("git",[...gitSafetyArgs(resolve(this.root)),...args],{cwd:resolve(this.root),shell:false,windowsHide:true});
      let stdout="",stderr="";
      child.stdout?.on("data",chunk=>stdout+=String(chunk).slice(0,262144));
      child.stderr?.on("data",chunk=>stderr+=String(chunk).slice(0,65536));
      child.on("error",reject);
      child.on("close",code=>code===0?resolveResult(stdout):reject(new Error(stderr.trim()||"Git command failed.")));
    });
  }
}
