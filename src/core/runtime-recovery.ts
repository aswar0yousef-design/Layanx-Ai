import type {Mission,ToolRequest} from "./types.js";
import type {ToolAdapter} from "../tools/executor.js";
import type {RuntimeSecurityContext} from "./runtime.js";
import {LayanXCore} from "./orchestrator.js";
import {MissionRunner} from "./mission-runner.js";
import {RuntimePersistence, type RuntimeSnapshot} from "./runtime-persistence.js";

export interface RecoveryReadinessIssue{code:string;message:string;}
export interface RecoveryReadiness{ready:boolean;issues:RecoveryReadinessIssue[];}

export interface RecoveryReport{
  missionId:string;
  missionGoal:string;
  missionStatus:Mission["status"];
  executionStatus:RuntimeSnapshot["executionState"]["status"];
  lastSavedAt:string;
  checkpoint:{available:boolean;stepId?:string;createdAt?:string};
  idempotency:{count:number;running:number;completed:number;failed:number};
  ledgerEntries:number;
  auditEntries:number;
  nextAction:string;
  readiness:RecoveryReadiness;
}

class RecoveryReadinessChecker{
  constructor(private readonly core:LayanXCore){}
  check(snapshot:RuntimeSnapshot,request:ToolRequest):RecoveryReadiness{
    const issues:RecoveryReadinessIssue[]=[];
    if(snapshot.mission.id!==request.missionId)issues.push({code:"MISSION_MISMATCH",message:"Recovery request does not belong to the persisted mission."});
    if(snapshot.executionState.missionId!==snapshot.mission.id)issues.push({code:"STATE_MISMATCH",message:"Persisted execution state does not belong to the mission."});
    try{
      const contract=this.core.agents.get(request.agentId);
      if(!contract.allowedTools.includes(request.tool))issues.push({code:"TOOL_NOT_ALLOWED",message:"Agent contract does not allow the requested tool."});
    }catch(error){issues.push({code:"AGENT_UNAVAILABLE",message:error instanceof Error?error.message:"Agent is unavailable."});}
    try{this.core.tools.get(request.tool);}catch(error){issues.push({code:"TOOL_UNAVAILABLE",message:error instanceof Error?error.message:"Tool is unavailable."});}
    if(snapshot.checkpoint && snapshot.checkpoint.missionId!==snapshot.mission.id)issues.push({code:"CHECKPOINT_MISMATCH",message:"Persisted checkpoint does not belong to the mission."});
    if(snapshot.idempotency?.some(record=>record.missionId!==snapshot.mission.id))issues.push({code:"IDEMPOTENCY_SCOPE",message:"Persisted idempotency state contains another mission."});
    return{ready:issues.length===0,issues};
  }
}

export interface RecoveryCandidate{
  missionId:string;
  status:RuntimeSnapshot["executionState"]["status"];
  missionStatus:Mission["status"];
  lastSavedAt:string;
  checkpointAvailable:boolean;
  resumeStepId?:string;
}

export class RuntimeRecoveryManager{
  constructor(private readonly persistence:RuntimePersistence,private readonly core:LayanXCore){}

  async inspect():Promise<RecoveryCandidate[]>{
    const snapshots=await this.persistence.resumable();
    return snapshots.map(s=>({
      missionId:s.mission.id,
      status:s.executionState.status,
      missionStatus:s.mission.status,
      lastSavedAt:s.savedAt,
      checkpointAvailable:Boolean(s.checkpoint),
      resumeStepId:s.checkpoint?.stepId
    }));
  }

  async report(missionId:string,request:ToolRequest):Promise<RecoveryReport>{
    const snapshot=await this.persistence.get(missionId);
    if(!snapshot)throw new Error("Unknown persisted mission.");
    const readiness=new RecoveryReadinessChecker(this.core).check(snapshot,request);
    const records=snapshot.idempotency??[];
    const resumable=["running","verifying"].includes(snapshot.executionState.status)||["running","verifying"].includes(snapshot.mission.status);
    return{
      missionId,
      missionGoal:snapshot.mission.goal,
      missionStatus:snapshot.mission.status,
      executionStatus:snapshot.executionState.status,
      lastSavedAt:snapshot.savedAt,
      checkpoint:{available:Boolean(snapshot.checkpoint),stepId:snapshot.checkpoint?.stepId,createdAt:snapshot.checkpoint?.createdAt},
      idempotency:{
        count:records.length,
        running:records.filter(record=>record.status==="running").length,
        completed:records.filter(record=>record.status==="completed").length,
        failed:records.filter(record=>record.status==="failed").length
      },
      ledgerEntries:snapshot.ledger.length,
      auditEntries:snapshot.audit.length,
      nextAction:!resumable?"No resume action: mission is not resumable.":readiness.ready?"Ready to resume from the persisted checkpoint.":"Blocked until recovery readiness issues are resolved.",
      readiness
    };
  }

  async resume(missionId:string,request:ToolRequest,adapter:ToolAdapter,approvalId?:string,security?:RuntimeSecurityContext){
    const snapshot=await this.persistence.get(missionId);
    if(!snapshot)throw new Error("Unknown persisted mission.");
    const readiness=new RecoveryReadinessChecker(this.core).check(snapshot,request);
    if(!readiness.ready)throw new Error("Recovery readiness failed: "+readiness.issues.map(issue=>issue.code).join(", "));

    if(!["running","verifying"].includes(snapshot.executionState.status) &&
       !["running","verifying"].includes(snapshot.mission.status)){
      throw new Error("Mission is not resumable.");
    }

    this.core.executionStates.restore(snapshot.executionState);
    this.core.ledger.restore(snapshot.ledger);
    this.core.audit.restore(snapshot.audit);
    this.core.recovery.restorePersisted(snapshot.checkpoint);
    if(snapshot.idempotency) await this.core.idempotency.restore(snapshot.idempotency);
    if(snapshot.memory) this.core.memory.restore(snapshot.memory);
    if(snapshot.handoffs) this.core.handoffs.restore(snapshot.handoffs);
    if(snapshot.delegatedTasks) this.core.delegation.restore(snapshot.delegatedTasks);
    const resumeStepId=snapshot.checkpoint?.stepId;
    if(resumeStepId){
      const resumeIndex=snapshot.mission.steps.findIndex(step=>step.id===resumeStepId);
      if(resumeIndex>=0){
        snapshot.mission.steps.forEach((step,index)=>{
          if(index<resumeIndex && step.status==="pending") step.status="completed";
          if(index===resumeIndex && step.status==="completed") step.status="running";
        });
      }
    }

    const runner=new MissionRunner(this.core);
    if(!security)throw new Error("Recovery security context is required.");
    const result=await runner.execute(snapshot.mission,request,adapter,approvalId,security);
    const updated=this.core.executionStates.get(missionId);
    if(updated){
      await this.persistence.saveAtomic({
        ...snapshot,
        mission:snapshot.mission,
        executionState:updated,
        ledger:this.core.ledger.forMission(missionId),
        audit:this.core.audit.forMission(missionId),
        checkpoint:this.core.recovery.restore(missionId)??snapshot.checkpoint,
        idempotency:(await this.core.idempotency.list()).filter(record=>record.missionId===missionId),
        memory:this.core.memory.list().filter(entry=>entry.missionId===missionId),
        handoffs:this.core.handoffs.forMission(missionId),
        delegatedTasks:this.core.delegation.forMission(missionId),
        nextAction:this.core.nextAction.decide({mission:snapshot.mission,tasks:this.core.delegation.forMission(missionId),handoffs:this.core.handoffs.forMission(missionId)}),
        savedAt:new Date().toISOString(),
        schemaVersion:1
      });
    }
    if(result.ok && result.verified){
      const persisted=await this.persistence.get(missionId);
      if(!persisted || persisted.executionState.status!=="completed" || persisted.mission.status!=="completed"){
        throw new Error("Post-resume state verification failed.");
      }
    }
    return result;
  }
}
