import type {Mission,ToolRequest} from "./types.js";
import type {ToolAdapter} from "../tools/executor.js";
import {LayanXCore} from "./orchestrator.js";
import {MissionRunner} from "./mission-runner.js";
import {RuntimePersistence, type RuntimeSnapshot} from "./runtime-persistence.js";

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

  async resume(missionId:string,request:ToolRequest,adapter:ToolAdapter,approvalId?:string){
    const snapshot=await this.persistence.get(missionId);
    if(!snapshot)throw new Error("Unknown persisted mission.");
    if(!["running","verifying"].includes(snapshot.executionState.status) &&
       !["running","verifying"].includes(snapshot.mission.status)){
      throw new Error("Mission is not resumable.");
    }

    this.core.executionStates.restore(snapshot.executionState);
    this.core.ledger.restore(snapshot.ledger);
    this.core.audit.restore(snapshot.audit);
    this.core.recovery.restorePersisted(snapshot.checkpoint);
    if(snapshot.idempotency) await this.core.idempotency.restore(snapshot.idempotency);
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
    const result=await runner.execute(snapshot.mission,request,adapter,approvalId);
    const updated=this.core.executionStates.get(missionId);
    if(updated){
      await this.persistence.saveAtomic({
        ...snapshot,
        mission:snapshot.mission,
        executionState:updated,
        ledger:this.core.ledger.forMission(missionId),
        audit:this.core.audit.forMission(missionId),
        checkpoint:this.core.recovery.restore(missionId)??snapshot.checkpoint,
        idempotency:await this.core.idempotency.list(),
        savedAt:new Date().toISOString(),
        schemaVersion:1
      });
    }
    return result;
  }
}
