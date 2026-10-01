import type {Mission,ToolRequest} from "./types.js";
import {LayanXCore} from "./orchestrator.js";
import type {ToolAdapter} from "../tools/executor.js";
import {BudgetGovernor} from "./budget-governor.js";
import {ApprovalEngine} from "../security/approval.js";

export interface RuntimeResult{ok:boolean;missionId:string;verified:boolean;error?:string;data?:unknown;}

export class ExecutionRuntime{
 readonly budget=new BudgetGovernor({maxToolCalls:100,maxRuntimeMs:60000,maxCostUsd:10});
 readonly approvals=new ApprovalEngine();
 constructor(private readonly core:LayanXCore){}
 async run(mission:Mission,request:ToolRequest,adapter:ToolAdapter,approvalId?:string):Promise<RuntimeResult>{
  const state=this.core.executionStates.get(mission.id)??this.core.executionStates.start(mission.id);
  const started=Date.now();
  const contract=this.core.agents.get(request.agentId);
  if(state.toolCalls>=contract.maxToolCalls)return this.block(mission,request,"Agent tool-call limit exceeded.");
  const risk=this.core.risk.assess(request);
  this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:risk.requiresApproval?"denied":"allowed",metadata:{risk:risk.level}});
  if(risk.requiresApproval){
   if(!approvalId)return this.block(mission,request,"Explicit approval is required for this risk level.");
   const approval=this.approvals.authorize(approvalId,{missionId:mission.id,agentId:request.agentId,action:request.action,permission:request.permission});
   if(!approval.allowed)return this.block(mission,request,approval.reason);
  }
  const permission=this.core.permissions.authorize(request,contract,request.permission);
  if(!permission.allowed)return this.block(mission,request,permission.reason);
  const sentinel=this.core.sentinel.inspect(request.action);
  if(!sentinel.allowed)return this.block(mission,request,sentinel.reason);
  const budget=this.budget.evaluate({toolCalls:state.toolCalls,runtimeMs:Date.now()-started,costUsd:state.costUsd});
  if(!budget.allowed)return this.block(mission,request,budget.reason);
  this.core.recovery.checkpoint({missionId:mission.id,stepId:mission.steps[0]?.id??"mission",createdAt:new Date().toISOString(),state:{request}});
  const result=await this.core.executor.execute(request,adapter);
  const runtimeMs=Date.now()-started;
  this.core.executionStates.update(mission.id,{toolCalls:state.toolCalls+1,runtimeMs:state.runtimeMs+runtimeMs,status:result.ok?"completed":"failed"});
  this.core.ledger.append({id:crypto.randomUUID(),missionId:mission.id,agentId:request.agentId,action:request.action,status:result.ok?"completed":"failed",timestamp:new Date().toISOString(),detail:result.error});
  if(!result.ok){
   this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"failure",metadata:{error:result.error}});
   return{ok:false,missionId:mission.id,verified:false,error:result.error};
  }
  const verification=this.core.verifier.verify(mission);
  if(!verification.verified){
   this.core.executionStates.update(mission.id,{status:"failed"});
   return{ok:false,missionId:mission.id,verified:false,error:verification.failures.join("; ")};
  }
  this.approvals.revokeMission(mission.id);
  this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"success"});
  return{ok:true,missionId:mission.id,verified:true,data:result.data};
 }
 private block(mission:Mission,request:ToolRequest,error:string):RuntimeResult{
  this.core.executionStates.update(mission.id,{status:"blocked"});
  this.core.ledger.append({id:crypto.randomUUID(),missionId:mission.id,agentId:request.agentId,action:request.action,status:"blocked",timestamp:new Date().toISOString(),detail:error});
  this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"denied",metadata:{reason:error}});
  return{ok:false,missionId:mission.id,verified:false,error};
 }
}
