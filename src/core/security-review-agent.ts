import {spawn} from "node:child_process";
import {resolve} from "node:path";

export interface SecurityFinding{
  severity:"info"|"low"|"medium"|"high"|"critical";
  category:"secret"|"command"|"filesystem"|"dependency"|"network"|"auth"|"policy";
  message:string;
  path?:string;
}

export interface SecurityReviewResult{
  branch:string;
  commit:string;
  files:string[];
  findings:SecurityFinding[];
  approved:boolean;
}

export class SecurityReviewAgent{
  constructor(private readonly root=process.env.LAYANX_WORKSPACE_ROOT??process.cwd()){}

  async review(baseRef="HEAD~1"):Promise<SecurityReviewResult>{
    const [branch,commit,filesText,diff]=await Promise.all([
      this.git(["branch","--show-current"]),
      this.git(["rev-parse","HEAD"]),
      this.git(["diff","--name-only",baseRef,"HEAD"]),
      this.git(["diff","--no-ext-diff","--unified=0",baseRef,"HEAD"])
    ]);
    const files=filesText.split("\n").filter(Boolean);
    const findings:SecurityFinding[]=[];
    const checks:[[RegExp,SecurityFinding["severity"],SecurityFinding["category"],string]]=[
      [/(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*["'][^"']{8,}["']/i,"critical","secret","Potential hard-coded credential detected."],
      [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,"critical","secret","Private key material detected."],
      [/\b(?:eval|Function)\s*\(/,"high","command","Dynamic code execution detected."],
      [/\bexec(?:File|Sync)?\s*\(/,"high","command","Direct process execution API detected."],
      [/shell\s*:\s*true/,"high","command","Shell execution explicitly enabled."],
      [/\.\.\/|\.\.\\/,"high","filesystem","Parent-directory traversal pattern detected."],
      [/http:\/\//i,"medium","network","Plain HTTP endpoint detected in changed code."],
      [/authorization\s*[:=].*Bearer\s+/i,"medium","auth","Bearer credential handling should be reviewed."],
    ];
    for(const [pattern,severity,category,message] of checks){
      if(pattern.test(diff))findings.push({severity,category,message});
    }
    if(files.some(file=>/package-lock\.json$|npm-shrinkwrap\.json$|pnpm-lock\.yaml$|yarn\.lock$/i.test(file)) &&
       files.some(file=>/package\.json$/i.test(file))){
      findings.push({severity:"medium",category:"dependency",message:"Dependency manifest and lockfile changed together; dependency changes require review."});
    }
    if(files.some(file=>/(\.env|credentials|secret|\.pem$|\.key$)/i.test(file))){
      findings.push({severity:"high",category:"secret",message:"Sensitive configuration or credential-like file changed.",path:files.find(file=>/(\.env|credentials|secret|\.pem$|\.key$)/i.test(file))});
    }
    const approved=!findings.some(f=>f.severity==="critical"||f.severity==="high");
    return{branch:branch.trim(),commit:commit.trim(),files,findings,approved};
  }

  private async git(args:string[]):Promise<string>{
    return await new Promise((resolveResult,reject)=>{
      const child=spawn("git",args,{cwd:resolve(this.root),shell:false,windowsHide:true});
      let stdout="",stderr="";
      child.stdout?.on("data",chunk=>stdout+=String(chunk).slice(0,262144));
      child.stderr?.on("data",chunk=>stderr+=String(chunk).slice(0,65536));
      child.on("error",reject);
      child.on("close",code=>code===0?resolveResult(stdout):reject(new Error(stderr.trim()||"Git command failed.")));
    });
  }
}
