import type {Mission,ToolRequest} from "./types.js";
import {LayanXCore} from "./orchestrator.js";
import type {ToolAdapter} from "../tools/executor.js";
import {BudgetGovernor} from "./budget-governor.js";
import {ApprovalEngine} from "../security/approval.js";
import type {RuntimePersistence} from "./runtime-persistence.js";

export interface RuntimeSecurityContext{projectId:string;capabilityId:string;}

export interface RuntimeResult{ok:boolean;missionId:string;verified:boolean;error?:string;data?:unknown;recoverable?:boolean;}

export class ExecutionRuntime{
 private readonly persistence:RuntimePersistence|undefined;
 readonly budget=new BudgetGovernor({maxToolCalls:100,maxRuntimeMs:60000,maxCostUsd:10});
 readonly approvals=new ApprovalEngine();
 constructor(private readonly core:LayanXCore,persistence?:RuntimePersistence){this.persistence=persistence??core.persistence;}
 async run(mission:Mission,request:ToolRequest,adapter:ToolAdapter,approvalId?:string,security?:RuntimeSecurityContext):Promise<RuntimeResult>{
  if(["completed","cancelled"].includes(mission.status))return{ok:false,missionId:mission.id,verified:false,error:"Mission is not executable in its current state.",recoverable:false};
  const state=this.core.executionStates.get(mission.id)??this.core.executionStates.start(mission.id);
  await this.persist(mission);
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
  const executionStep=mission.steps.find(step=>/execute|run|perform|action/i.test(step.description))??mission.steps.find(step=>step.status==="pending");
  if(executionStep) executionStep.status="running";
  this.core.recovery.checkpoint({missionId:mission.id,stepId:executionStep?.id??"mission",createdAt:new Date().toISOString(),state:{request}});
  await this.persist(mission);
  const result=await this.core.executor.execute(request,adapter);
  const runtimeMs=Date.now()-started;
  this.core.executionStates.update(mission.id,{toolCalls:state.toolCalls+1,runtimeMs:state.runtimeMs+runtimeMs,status:result.ok?"completed":"failed"});
  mission.steps[3] && (mission.steps[3].status=result.ok?"completed":"failed");
  this.core.ledger.append({id:crypto.randomUUID(),missionId:mission.id,agentId:request.agentId,action:request.action,status:result.ok?"completed":"failed",timestamp:new Date().toISOString(),detail:result.error});
  await this.persist(mission);
  if(!result.ok){
   mission.status="failed";
   this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"failure",metadata:{error:result.error,missionId:mission.id}});
   await this.persist(mission);
   return{ok:false,missionId:mission.id,verified:false,error:result.error,recoverable:true};
  }
  mission.status="verifying";
  const verification=this.core.verifier.verify(mission,result.data,contract.successCriteria);
  if(verification.verified && mission.steps[4]) mission.steps[4].status="completed";
  if(!verification.verified){
   mission.status="failed";
   this.core.executionStates.update(mission.id,{status:"failed"});
   await this.persist(mission);
   return{ok:false,missionId:mission.id,verified:false,error:verification.failures.join("; "),recoverable:false};
  }
  mission.status="completed";
  this.core.memory.remember({missionId:mission.id,kind:"success",summary:mission.goal,content:{result:result.data,verified:true,tool:request.tool,action:request.action},confidence:1,tags:[request.tool]});
  this.approvals.revokeMission(mission.id);
  this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"success",metadata:{missionId:mission.id}});
  await this.persist(mission);
  return{ok:true,missionId:mission.id,verified:true,data:result.data,recoverable:false};
 }
 private async persist(mission:Mission):Promise<void>{
  if(!this.persistence)return;
  const executionState=this.core.executionStates.get(mission.id);
  if(!executionState)return;
  await this.persistence.saveAtomic({
    mission,
    executionState,
    ledger:this.core.ledger.forMission(mission.id),
    audit:this.core.audit.forMission(mission.id),
    checkpoint:this.core.recovery.restore(mission.id),
    idempotency:(await this.core.idempotency.list()).filter(record=>record.missionId===mission.id),
    memory:this.core.memory.list().filter(entry=>entry.missionId===mission.id),
    savedAt:new Date().toISOString(),
    schemaVersion:1
  });
 }
 private async block(mission:Mission,request:ToolRequest,error:string):Promise<RuntimeResult>{
  mission.status="blocked";
  this.core.executionStates.update(mission.id,{status:"blocked"});
  this.core.ledger.append({id:crypto.randomUUID(),missionId:mission.id,agentId:request.agentId,action:request.action,status:"blocked",timestamp:new Date().toISOString(),detail:error});
  this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"denied",metadata:{reason:error}});
  await this.persist(mission);
  return{ok:false,missionId:mission.id,verified:false,error,recoverable:false};
 }
}
