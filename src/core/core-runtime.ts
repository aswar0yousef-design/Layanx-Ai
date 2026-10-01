import type {PermissionLevel,ToolRequest} from "./types.js";
import type {ToolAdapter} from "../tools/executor.js";
import {LayanXCore} from "./orchestrator.js";
import {MissionRunner} from "./mission-runner.js";
export interface CoreRunResult{ok:boolean;missionId:string;verified:boolean;decision:string;error?:string;data?:unknown;}
const rank:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};
export class CoreRuntime{
 private readonly runner:MissionRunner;
 constructor(private readonly core:LayanXCore){this.runner=new MissionRunner(core);}
 async run(goal:string,request:Omit<ToolRequest,"missionId">,adapter:ToolAdapter,capabilityTokenId?:string,projectId="default",approvalId?:string):Promise<CoreRunResult>{
  const mission=this.core.startMission(goal);
  const effectiveToken=capabilityTokenId??(rank[request.permission]===1?this.core.capabilities.issue({
   missionId:mission.id,agentId:request.agentId,projectId,resource:request.tool,permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()
  }):undefined);
  if(!effectiveToken)return{ok:false,missionId:mission.id,verified:false,decision:"blocked",error:"A scoped capability token is required above L1_READ."};
  const gate=this.core.capabilities.authorize(effectiveToken,{missionId:mission.id,agentId:request.agentId,projectId,resource:request.tool,permission:request.permission});
  if(!gate.allowed)return{ok:false,missionId:mission.id,verified:false,decision:"blocked",error:gate.reason};
  const risk=this.core.risk.assess({...request,missionId:mission.id});
  const decision=this.core.noAction.evaluate({risk:risk.level,hasRequiredApproval:Boolean(approvalId),budgetAvailable:true,goalRequiresAction:true});
  if(decision!=="execute")return{ok:false,missionId:mission.id,verified:false,decision,error:"Execution decision is "+decision};
  const result=await this.runner.execute(mission,{...request,missionId:mission.id},adapter,approvalId);
  if(result.ok)this.core.capabilities.revoke(effectiveToken);
  return{...result,decision};
 }
}
