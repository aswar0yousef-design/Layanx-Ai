import type {Mission,ToolRequest} from "./types.js";
import type {AgentContract} from "./contracts.js";
import {PermissionEngine} from "../security/permission.js";
import {RiskEngine} from "../security/risk.js";
import {Sentinel} from "../security/sentinel.js";
import {CapabilityGate} from "../security/capability-gate.js";
import {ApprovalEngine} from "../security/approval.js";
import {ToolExecutor,type ToolAdapter} from "../tools/executor.js";
import {ExecutionStateStore,type ExecutionState} from "./execution-state.js";
import {BudgetGuard,type Budget} from "./budget.js";
import {VerificationEngine} from "./verification.js";
import {AgentLedger} from "./ledger.js";
import {AuditLog} from "./audit.js";
import {RecoveryManager,type Checkpoint} from "./recovery.js";
import type {IdempotencyService,IdempotencyRecord} from "./idempotency.js";

export interface RuntimeContext{
  projectId:string;
  capabilityId:string;
  approvalId?:string;
  costUsd?:number;
}

export interface RuntimeSnapshot{
  checkpoint:Checkpoint;
  executionState:ExecutionState;
  idempotency:IdempotencyRecord[];
}

export interface RuntimeDependencies{
  agents:{get(id:string):AgentContract};
  permissions:PermissionEngine;
  risk:RiskEngine;
  sentinel:Sentinel;
  capabilities:CapabilityGate;
  approvals:ApprovalEngine;
  executor:ToolExecutor;
  executionStates:ExecutionStateStore;
  budget:BudgetGuard;
  budgetLimits:Budget;
  verifier:VerificationEngine;
  ledger:AgentLedger;
  audit:AuditLog;
  recovery:RecoveryManager;
  idempotency:IdempotencyService;
}

export class ExecutionRuntime{
  constructor(private readonly core:RuntimeDependencies){}

  async run(mission:Mission,request:ToolRequest,adapter:ToolAdapter,context:RuntimeContext){
    if(request.missionId!==mission.id)return this.block(request,"Mission scope mismatch.");
    const started=Date.now();
    const contract=this.core.agents.get(request.agentId);

    const risk=this.core.risk.assess(request);
    this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:risk.requiresApproval?"denied":"allowed",metadata:{risk:risk.level}});

    const permission=this.core.permissions.authorize(request,contract,request.permission);
    if(!permission.allowed)return this.block(request,permission.reason);

    const capability=this.core.capabilities.authorize(context.capabilityId,{
      missionId:mission.id,agentId:request.agentId,projectId:context.projectId,
      resource:request.tool,permission:request.permission
    });
    if(!capability.allowed)return this.block(request,capability.reason);

    if(risk.requiresApproval){
      if(!context.approvalId)return this.block(request,"Explicit approval is required for this risk level.");
      const approval=this.core.approvals.authorize(context.approvalId,{
        missionId:mission.id,agentId:request.agentId,action:request.action,permission:request.permission
      });
      if(!approval.allowed)return this.block(request,approval.reason);
    }

    const sentinel=this.core.sentinel.inspect(request.action);
    if(!sentinel.allowed)return this.block(request,sentinel.reason);

    const state=this.core.executionStates.get(mission.id)??this.core.executionStates.start(mission.id);
    const budget=this.core.budget.check(this.core.budgetLimits,{
      toolCalls:state.toolCalls,runtimeMs:Date.now()-Date.parse(state.startedAt),costUsd:state.costUsd+(context.costUsd??0)
    });
    if(!budget.allowed)return this.block(request,budget.reason);

    const result=await this.core.executor.execute(request,adapter);
    if(!result.replayed)this.core.executionStates.update(mission.id,{toolCalls:state.toolCalls+1,costUsd:state.costUsd+(context.costUsd??0)});
    const executionStep=mission.steps.find(step=>step.description.startsWith("Execute"));
    if(executionStep)executionStep.status=result.ok?"completed":"failed";
    const verification=this.core.verifier.verify(mission,result.data,[]);
    const elapsed=Date.now()-started;

    if(!result.ok||!verification.verified){
      this.core.executionStates.update(mission.id,{status:"failed",runtimeMs:elapsed});
      this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"failure",metadata:{error:result.error,verification:verification.failures}});
      const checkpoint=await this.checkpoint(mission,request.idempotencyKey);
      return{ok:false,missionId:mission.id,verified:false,error:result.error??verification.failures.join("; "),checkpoint};
    }

    this.core.executionStates.update(mission.id,{status:"completed",runtimeMs:elapsed});
    this.core.ledger.append({id:crypto.randomUUID(),missionId:mission.id,agentId:request.agentId,action:request.action,status:"completed",timestamp:new Date().toISOString(),detail:request.tool});
    this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"success",metadata:{risk:risk.level}});
    const checkpoint=await this.checkpoint(mission,request.idempotencyKey);
    this.core.approvals.revokeMission(mission.id);
    return{ok:true,missionId:mission.id,verified:true,data:result.data,checkpoint};
  }

  async checkpoint(mission:Mission,stepId:string):Promise<RuntimeSnapshot>{
    const executionState=this.core.executionStates.get(mission.id)??this.core.executionStates.start(mission.id);
    const checkpoint:Checkpoint={missionId:mission.id,stepId,createdAt:new Date().toISOString(),state:structuredClone(executionState)};
    this.core.recovery.checkpoint(checkpoint);
    return{checkpoint,executionState,idempotency:await this.core.idempotency.list()};
  }

  async restore(snapshot:RuntimeSnapshot){
    this.core.executionStates.restore(snapshot.executionState);
    await this.core.idempotency.restore(snapshot.idempotency);
    this.core.recovery.restorePersisted(snapshot.checkpoint);
    return this.core.executionStates.get(snapshot.executionState.missionId);
  }

  private block(request:ToolRequest,error:string){
    this.core.audit.append({timestamp:new Date().toISOString(),actor:request.agentId,action:request.action,resource:request.tool,result:"denied",metadata:{reason:error}});
    return{ok:false,missionId:request.missionId,verified:false,error};
  }
}
