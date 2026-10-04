import type {Mission,ToolRequest} from "./types.js";
import {LayanXCore} from "./orchestrator.js";
import type {ToolAdapter} from "../tools/executor.js";
import {BudgetGovernor} from "./budget-governor.js";
import {createHash} from "node:crypto";
import {ApprovalEngine} from "../security/approval.js";
import type {RuntimePersistence} from "./runtime-persistence.js";
import {setLifecycle} from "./lifecycle.js";

export interface RuntimeSecurityContext{projectId:string;capabilityId:string;}

export interface RuntimeResult{ok:boolean;missionId:string;verified:boolean;error?:string;data?:unknown;recoverable?:boolean;approvalId?:string;}

export class ExecutionRuntime{
 private readonly persistence:RuntimePersistence|undefined;
 readonly budget=new BudgetGovernor({maxToolCalls:100,maxRuntimeMs:60000,maxCostUsd:10});
 readonly approvals=new ApprovalEngine();
 constructor(private readonly core:LayanXCore,persistence?:RuntimePersistence){this.persistence=persistence??core.persistence;}
 async run(mission:Mission,request:ToolRequest,adapter:ToolAdapter,approvalId?:string,security?:RuntimeSecurityContext,runtimeOptions:{deferVerification?:boolean}={}):Promise<RuntimeResult>{
  if(["completed","cancelled"].includes(mission.status)){
   const replay=await this.core.idempotency.get(request.idempotencyKey);
   if(mission.status==="completed"&&replay?.status==="completed"&&replay.missionId===mission.id&&replay.agentId===request.agentId&&replay.tool===request.tool&&replay.action===request.action){
    const executionStep=mission.steps.find(step=>/execute|run|perform|action/i.test(step.description));
    if(executionStep)executionStep.status="completed";
    setLifecycle(mission,this.core.executionStates,"completed",false);
    await this.persist(mission);
    return{ok:true,missionId:mission.id,verified:true,data:replay.data,recoverable:false};
   }
   return{ok:false,missionId:mission.id,verified:false,error:"Mission is not executable in its current state.",recoverable:false};
  }
  if(!security)return this.block(mission,request,"Capability context is required.");
  let projectId:string;
  try{
   projectId=this.core.projectIsolation.normalize(security.projectId);
   this.core.projectIsolation.assertMissionProject(projectId,mission.projectId);
   if(request.projectId)this.core.projectIsolation.assertRequestProject(projectId,request.projectId);
   request={...request,projectId};
  }catch(error){
   const message=error instanceof Error?error.message:"Project isolation violation.";
   this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"denied",metadata:{reason:message,missionId:mission.id,projectId:security.projectId}});
   return{ok:false,missionId:mission.id,verified:false,error:message,recoverable:false};
  }
  const state=this.core.executionStates.get(mission.id)??this.core.executionStates.start(mission.id);
  const started=Date.now();
  const trace=this.core.tracer.start("mission-tool","tool",{missionId:mission.id,projectId:projectId,agentId:request.agentId,tool:request.tool,action:request.action});
  const contract=this.core.agents.get(request.agentId);
  setLifecycle(mission,this.core.executionStates,"running",true);
  if(state.toolCalls>=contract.maxToolCalls)return this.block(mission,request,"Agent tool-call limit exceeded.");
  const toolDefinition=this.core.tools.get(request.tool);
  const risk=this.core.risk.assess(request);
  const rank:Record<import("./types.js").PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};
  if(rank[request.permission]>=3){
   let impact;
   try{
    impact=await this.core.prepareChangeImpact(mission,projectId,{tool:request.tool,action:request.action});
   }catch(error){
    return this.block(mission,request,error instanceof Error?"Change impact analysis failed: "+error.message:"Change impact analysis failed.");
   }
  }
  this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:risk.requiresApproval?"pending_approval":"allowed",metadata:{risk:risk.level,missionId:mission.id}});
  if(rank[request.permission]>rank[mission.requiredPermission])return this.block(mission,request,"Requested permission exceeds mission scope.");
  if(rank[request.permission]>rank[contract.requiredPermission])return this.block(mission,request,"Requested permission exceeds agent scope.");
  if(rank[toolDefinition.permission]>rank[request.permission])return this.block(mission,request,"Requested permission is below the tool requirement.");
  const permission=this.core.permissions.authorize(request,contract,request.permission);
  if(!permission.allowed)return this.block(mission,request,permission.reason);
  const capability=this.core.capabilities.authorize(security.capabilityId,{missionId:mission.id,agentId:request.agentId,projectId:projectId,resource:request.tool,permission:request.permission});
  if(!capability.allowed)return this.block(mission,request,capability.reason);
  if(risk.requiresApproval){
   if(!approvalId){
    const approval=this.ensureApproval(mission,request,"Explicit approval is required for this risk level.");
    return this.block(mission,request,"Explicit approval is required for this risk level.",approval.id);
   }
   const approval=this.approvals.authorize(approvalId,{missionId:mission.id,agentId:request.agentId,tool:request.tool,action:request.action,permission:request.permission,payloadHash:createHash("sha256").update(JSON.stringify(request.payload??null)).digest("hex")});
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
  let result;
  try{result=await this.core.executor.execute(request,adapter);}catch(error){this.core.tracer.end(trace,"failure",{error:error instanceof Error?error.message:"tool execution failed"});throw error;}
  const runtimeMs=Date.now()-started;
  this.core.tracer.end(trace,result.ok?"success":"failure",{runtimeMs,ok:result.ok});
  if(request.tool!=="memory.recall")this.core.memory.remember({
   missionId:mission.id,
   projectId:projectId,
   kind:result.ok?"experience":"failure",
   summary:result.ok?`Tool ${request.tool} completed: ${request.action}`:`Tool ${request.tool} failed: ${request.action}`,
   content:{tool:request.tool,action:request.action,planIndex:request.planIndex,result:result.ok?result.data:result.error},
   confidence:result.ok?0.9:1,
   tags:["mission","tool",request.tool,result.ok?"success":"failure"]
  });
  this.core.executionStates.update(mission.id,{toolCalls:state.toolCalls+1,runtimeMs:state.runtimeMs+runtimeMs});
  if(executionStep) executionStep.status=result.ok?"completed":"failed";
  this.core.ledger.append({id:crypto.randomUUID(),missionId:mission.id,agentId:request.agentId,action:request.action,status:result.ok?"completed":"failed",timestamp:new Date().toISOString(),detail:result.error});
  if(!result.ok){
   this.core.failureLearning.record({missionId:mission.id,projectId:projectId,error:result.error,tool:request.tool,action:request.action,recoverable:true});
   setLifecycle(mission,this.core.executionStates,"failed",true);
   this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"failure",metadata:{error:result.error,missionId:mission.id}});
   await this.persist(mission);
   return{ok:false,missionId:mission.id,verified:false,error:result.error,recoverable:true};
  }
  const planCount=mission.tools?.length??0;
  const currentPlanIndex=request.planIndex??(planCount>0?planCount-1:0);
  const hasNextTool=planCount>0&&currentPlanIndex<planCount-1;
  if(runtimeOptions.deferVerification||hasNextTool){
   setLifecycle(mission,this.core.executionStates,"running");
   this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"success",metadata:{missionId:mission.id,planIndex:currentPlanIndex,nextPlanIndex:currentPlanIndex+1}});
   await this.persist(mission);
   return{ok:true,missionId:mission.id,verified:false,data:result.data,recoverable:true};
  }
  setLifecycle(mission,this.core.executionStates,"verifying",true);
  await this.persist(mission);
  const verification=this.core.verifier.verify(mission,result.data,mission.successCriteria?.length?mission.successCriteria:contract.successCriteria);
  if(verification.verified){
   const verificationStep=mission.steps.find(step=>/verif|confirm|validate|check/i.test(step.description));
   if(verificationStep) verificationStep.status="completed";
  }
  if(!verification.verified){
   setLifecycle(mission,this.core.executionStates,"failed",false);
   await this.persist(mission);
   return{ok:false,missionId:mission.id,verified:false,error:verification.failures.join("; "),recoverable:false};
  }
  setLifecycle(mission,this.core.executionStates,"completed",false);
  this.core.memory.remember({missionId:mission.id,projectId:projectId,kind:"success",summary:mission.goal,content:{result:result.data,verified:true,tool:request.tool,action:request.action},confidence:1,tags:[request.tool]});
  this.approvals.revokeMission(mission.id);
  this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"success",metadata:{missionId:mission.id}});
  await this.persist(mission);
  return{ok:true,missionId:mission.id,verified:true,data:result.data,recoverable:false};
 }
 async finalize(mission:Mission,result:unknown,agentId="core"):Promise<RuntimeResult>{
  const contract=this.core.agents.get(agentId);
  setLifecycle(mission,this.core.executionStates,"verifying",true);
  const verification=this.core.verifier.verify(mission,result,mission.successCriteria?.length?mission.successCriteria:contract.successCriteria);
  if(!verification.verified){
   setLifecycle(mission,this.core.executionStates,"failed",false);
   await this.persist(mission);
   return{ok:false,missionId:mission.id,verified:false,error:verification.failures.join("; "),recoverable:false};
  }
  setLifecycle(mission,this.core.executionStates,"completed",false);
  this.core.memory.remember({missionId:mission.id,kind:"success",summary:mission.goal,content:{result,verified:true},confidence:1,tags:["mission"]});
  this.approvals.revokeMission(mission.id);
  this.core.audit.append({timestamp:new Date().toISOString(),actor:agentId,action:"mission.verify",resource:mission.id,result:"success",metadata:{missionId:mission.id}});
  await this.persist(mission);
  return{ok:true,missionId:mission.id,verified:true,data:result,recoverable:false};
 }

 async persist(mission:Mission):Promise<void>{
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
    handoffs:this.core.handoffs.forMission(mission.id),
    delegatedTasks:this.core.delegation.forMission(mission.id),
    approvals:this.approvals.snapshot(),
    nextAction:this.core.nextAction.decide({mission,tasks:this.core.delegation.forMission(mission.id),handoffs:this.core.handoffs.forMission(mission.id)}),
    savedAt:new Date().toISOString(),
    schemaVersion:1
  });
 }
 private ensureApproval(mission:Mission,request:ToolRequest,reason:string){
  return this.approvals.ensure({missionId:mission.id,agentId:request.agentId,tool:request.tool,action:request.action,permission:request.permission,payloadHash:createHash("sha256").update(JSON.stringify(request.payload??null)).digest("hex"),reason,expiresAt:new Date(Date.now()+15*60*1000).toISOString()});
 }
 private async block(mission:Mission,request:ToolRequest,error:string,approvalId?:string):Promise<RuntimeResult>{
  if(!this.core.executionStates.get(mission.id))this.core.executionStates.start(mission.id);
  setLifecycle(mission,this.core.executionStates,"blocked",false);
  this.core.ledger.append({id:crypto.randomUUID(),missionId:mission.id,agentId:request.agentId,action:request.action,status:"blocked",timestamp:new Date().toISOString(),detail:error});
  this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"denied",metadata:{reason:error}});
  await this.persist(mission);
  return{ok:false,missionId:mission.id,verified:false,error,recoverable:false,approvalId};
 }
}
