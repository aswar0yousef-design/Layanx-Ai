import {readFile,writeFile,mkdir,rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import {createHash} from "node:crypto";
import {resolve,relative,sep,isAbsolute,dirname} from "node:path";
import type {LayanXCore} from "./orchestrator.js";

export interface CodeChange{
  path:string;
  content:string;
}

export interface SafeModificationRequest{
  projectId:string;
  missionId:string;
  agentId?:string;
  changes:CodeChange[];
  approvalId?:string;
  runTests?:boolean;
}

export interface SafeModificationResult{
  ok:boolean;
  projectId:string;
  missionId:string;
  changedFiles:string[];
  selectedTests:string[];
  impactRisk:string;
  backupId?:string;
  tests?:unknown;
  error?:string;
}

export class SafeCodeModifier{
  private readonly root:string;
  constructor(private readonly core:LayanXCore,root=process.env.LAYANX_WORKSPACE_ROOT??process.cwd()){this.root=resolve(root);}

  async apply(request:SafeModificationRequest):Promise<SafeModificationResult>{
    const projectId=this.core.projectIsolation.normalize(request.projectId);
    const mission=this.core.missions.get(request.missionId);
    if(!mission)throw new Error("Mission not found.");
    this.core.projectIsolation.assertMissionProject(projectId,mission.projectId);
    if(!request.changes.length)throw new Error("At least one code change is required.");
    if(request.changes.length>20)throw new Error("Too many files in one safe modification.");
    const validated=await Promise.all(request.changes.map(change=>this.validateChange(projectId,change)));
    const graph=await this.core.projectGraph.scan(projectId);
    const impact=this.core.impactAnalyzer.analyze(graph,validated.map(change=>change.path).join(" "));
    mission.impactAnalysis=impact;
    mission.selectedTests=this.core.testSelector.select(graph,impact).tests;
    if(["high","critical"].includes(impact.risk)){
      if(!request.approvalId)throw new Error("Explicit approval is required for high or critical modification impact.");
      const approvalHash=createHash("sha256").update(JSON.stringify(validated)).digest("hex");
      const approval=this.core.executionRuntime.approvals.authorize(request.approvalId,{
        missionId:request.missionId,agentId:request.agentId??"core",tool:"code",action:"modify",
        permission:"L3_MODIFY",payloadHash:approvalHash
      });
      if(!approval.allowed)throw new Error(approval.reason);
    }
    const backupId=crypto.randomUUID();
    const workspace=this.workspace(projectId);
    const backupDir=resolve(workspace,".layanx","backups",backupId);
    await mkdir(backupDir,{recursive:true});
    const originals:{path:string;exists:boolean;content?:string}[]=[];
    try{
      for(const change of validated){
        const target=resolve(workspace,change.path);
        let original:Buffer|undefined;
        try{original=await readFile(target);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
        originals.push(original?{path:change.path,exists:true,content:original.toString("utf8")}:{path:change.path,exists:false});
        if(original)await this.writeBackup(backupDir,change.path,original);
        await mkdir(dirname(target),{recursive:true});
        await writeFile(target,change.content,"utf8");
      }
      this.core.projectIntelligence.invalidate(projectId);
      const result=request.runTests===false?undefined:await this.core.runSelectedTests(mission,projectId,mission.selectedTests);
      if(result&&!result.ok)throw new Error("Post-modification tests failed.");
      this.core.audit.append({timestamp:new Date().toISOString(),actor:"safe-modifier",action:"code.modify",resource:request.missionId,result:"success",metadata:{projectId,changedFiles:validated.map(c=>c.path),backupId,impactRisk:impact.risk,tests:mission.selectedTests}});
      return{ok:true,projectId,missionId:request.missionId,changedFiles:validated.map(c=>c.path),selectedTests:mission.selectedTests,impactRisk:impact.risk,backupId,tests:result};
    }catch(error){
      await this.rollback(workspace,originals);
      this.core.projectIntelligence.invalidate(projectId);
      this.core.audit.append({timestamp:new Date().toISOString(),actor:"safe-modifier",action:"code.modify.rollback",resource:request.missionId,result:"failure",metadata:{projectId,backupId,error:error instanceof Error?error.message:"modification failed"}});
      return{ok:false,projectId,missionId:request.missionId,changedFiles:validated.map(c=>c.path),selectedTests:mission.selectedTests,impactRisk:impact.risk,backupId,error:error instanceof Error?error.message:"Modification failed."};
    }
  }

  private async validateChange(projectId:string,change:CodeChange):Promise<CodeChange>{
    const path=change.path.trim().replaceAll("\\","/");
    if(!path||path.startsWith("/")||isAbsolute(path)||path===".."||path.startsWith("../")||path.includes("/../"))
      throw new Error("Unsafe code modification path: "+change.path);
    if(path.split("/").some(part=>part==="."||part===".."))throw new Error("Unsafe code modification path: "+change.path);
    if(/(^|/)(node_modules|.git|dist|build|coverage|.next|.turbo|.cache)(/|$)/.test(path))
      throw new Error("Protected generated/dependency path: "+path);
    if(path.startsWith(".layanx/"))throw new Error("LayanX internal state cannot be modified through SafeCodeModifier.");
    if(change.content.length>1024*1024)throw new Error("Code change exceeds the per-file size limit.");
    const target=resolve(this.workspace(projectId),path);
    const root=resolve(this.workspace(projectId));
    const rel=relative(root,target);
    if(rel.startsWith(".."+sep)||isAbsolute(rel))throw new Error("Modification escapes the project workspace.");
    if(!/\.(ts|tsx|js|jsx|mjs|cjs|json|md|yml|yaml|css|scss|html|sql)$/i.test(path))
      throw new Error("Unsupported code modification file type.");
    return{path,content:change.content};
  }

  private workspace(projectId:string){const safe=projectId.trim();if(!safe||safe.includes("/")||safe.includes("\\"))throw new Error("Invalid project workspace identity.");return resolve(this.root,safe);}
  private async writeBackup(dir:string,path:string,content:Buffer){
    const target=resolve(dir,path);
    await mkdir(dirname(target),{recursive:true});
    await writeFile(target,content);
  }
  private async rollback(workspace:string,originals:{path:string;exists:boolean;content?:string}[]){
    for(const original of originals.reverse()){
      const target=resolve(workspace,original.path);
      if(original.exists)await writeFile(target,original.content??"","utf8");
      else await rm(target,{force:true});
    }
  }
}
