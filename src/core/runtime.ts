import type {Mission,ToolRequest} from "./types.js";
import {LayanXCore} from "./orchestrator.js";
import type {ToolAdapter} from "../tools/executor.js";
import {BudgetGovernor} from "./budget-governor.js";
import {ApprovalEngine} from "../security/approval.js";

export interface RuntimeSecurityContext{projectId:string;capabilityId:string;}

export interface RuntimeResult{ok:boolean;missionId:string;verified:boolean;error?:string;data?:unknown;recoverable?:boolean;}

export class ExecutionRuntime{
 readonly budget=new BudgetGovernor({maxToolCalls:100,maxRuntimeMs:60000,maxCostUsd:10});
 readonly approvals=new ApprovalEngine();
 constructor(private readonly core:LayanXCore){}
 async run(mission:Mission,request:ToolRequest,adapter:ToolAdapter,approvalId?:string,security?:RuntimeSecurityContext):Promise<RuntimeResult>{
  if(["completed","cancelled"].includes(mission.status))return{ok:false,missionId:mission.id,verified:false,error:"Mission is not executable in its current state.",recoverable:false};
  const state=this.core.executionStates.get(mission.id)??this.core.executionStates.start(mission.id);
  const started=Date.now();
  const contract=this.core.agents.get(request.agentId);
  mission.status="running";
  this.core.executionStates.update(mission.id,{status:"running"});
  if(state.toolCalls>=contract.maxToolCalls)return this.block(mission,request,"Agent tool-call limit exceeded.");
  const risk=this.core.risk.assess(request);
  this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:risk.requiresApproval?"denied":"allowed",metadata:{risk:risk.level,missionId:mission.id}});
  const permission=this.core.permissions.authorize(request,contract,request.permission);
  if(!permission.allowed)return this.block(mission,request,permission.reason);
  if(!security)return this.block(mission,request,"Capability context is required.");
  const capability=this.core.capabilities.authorize(security.capabilityId,{missionId:mission.id,agentId:request.agentId,projectId:security.projectId,resource:request.tool,permission:request.permission});
  if(!capability.allowed)return this.block(mission,request,capability.reason);
  if(risk.requiresApproval){
   if(!approvalId)return this.block(mission,request,"Explicit approval is required for this risk level.");
   const approval=this.approvals.authorize(approvalId,{missionId:mission.id,agentId:request.agentId,action:request.action,permission:request.permission});
   if(!approval.allowed)return this.block(mission,request,approval.reason);
  }
  const sentinel=this.core.sentinel.inspect(request.action);
  if(!sentinel.allowed)return this.block(mission,request,sentinel.reason);
  const budget=this.budget.evaluate({toolCalls:state.toolCalls,runtimeMs:Date.now()-started,costUsd:state.costUsd});
  if(!budget.allowed)return this.block(mission,request,budget.reason);
  const executionStep=mission.steps.find(step=>step.description.startsWith("Execute"));
  if(executionStep) executionStep.status="running";
  this.core.recovery.checkpoint({missionId:mission.id,stepId:executionStep?.id??"mission",createdAt:new Date().toISOString(),state:{request}});
  const result=await this.core.executor.execute(request,adapter);
  const runtimeMs=Date.now()-started;
  this.core.executionStates.update(mission.id,{toolCalls:state.toolCalls+1,runtimeMs:state.runtimeMs+runtimeMs,status:result.ok?"completed":"failed"});
  mission.steps[3] && (mission.steps[3].status=result.ok?"completed":"failed");
  this.core.ledger.append({id:crypto.randomUUID(),missionId:mission.id,agentId:request.agentId,action:request.action,status:result.ok?"completed":"failed",timestamp:new Date().toISOString(),detail:result.error});
  if(!result.ok){
   mission.status="failed";
   this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"failure",metadata:{error:result.error,missionId:mission.id}});
   return{ok:false,missionId:mission.id,verified:false,error:result.error,recoverable:true};
  }
  mission.status="verifying";
  const verification=this.core.verifier.verify(mission,result.data,contract.successCriteria);
  if(verification.verified && mission.steps[4]) mission.steps[4].status="completed";
  if(!verification.verified){
   mission.status="failed";
   this.core.executionStates.update(mission.id,{status:"failed"});
   return{ok:false,missionId:mission.id,verified:false,error:verification.failures.join("; "),recoverable:false};
  }
  mission.status="completed";
  this.approvals.revokeMission(mission.id);
  this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"success",metadata:{missionId:mission.id}});
  return{ok:true,missionId:mission.id,verified:true,data:result.data,recoverable:false};
 }
 private block(mission:Mission,request:ToolRequest,error:string):RuntimeResult{
  mission.status="blocked";
  this.core.executionStates.update(mission.id,{status:"blocked"});
  this.core.ledger.append({id:crypto.randomUUID(),missionId:mission.id,agentId:request.agentId,action:request.action,status:"blocked",timestamp:new Date().toISOString(),detail:error});
  this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"denied",metadata:{reason:error}});
  return{ok:false,missionId:mission.id,verified:false,error,recoverable:false};
 }
}
