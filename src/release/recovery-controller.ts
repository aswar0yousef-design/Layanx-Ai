import {ReleaseHealthProbe} from "./health-probe.js";
import {RollbackController, type Deployment, type RecoveryDecision} from "./rollback.js";
import {RecoveryAuditTrail} from "./recovery-audit.js";
import type {RollbackExecutor} from "./rollback-executor.js";
import {RecoveryPersistence, type PersistedRecoveryRecord} from "./recovery-persistence.js";
import {RecoveryResumeEngine, type RecoveryResumePlan} from "./recovery-resume.js";
import {createRecoveryReport, type RecoveryReport} from "./recovery-report.js";

export interface RecoveryRunResult{
 decision:RecoveryDecision;
 audit:ReturnType<RecoveryAuditTrail["summarize"]>;
 attempts:number;
}

export interface RecoveryControllerOptions{
 actor?:string;
 maxAttempts?:number;
 persistence?:RecoveryPersistence;
 recoveryId?:string;
}

export class ProductionRecoveryController{
 private readonly actor:string;
 private readonly maxAttempts:number;
 private readonly executor:RollbackExecutor;
 private readonly persistence?:RecoveryPersistence;
 private readonly recoveryId?:string;
 private readonly resumeEngine=new RecoveryResumeEngine();

 constructor(
  private readonly healthProbe:ReleaseHealthProbe,
  private readonly rollback:RollbackController,
  private readonly audit:RecoveryAuditTrail,
  executor:RollbackExecutor,
  options:RecoveryControllerOptions={}
 ){
  this.actor=options.actor??"release-controller";
  this.executor=executor;
  this.persistence=options.persistence;
  this.recoveryId=options.recoveryId;
  this.maxAttempts=Math.max(1,Math.floor(options.maxAttempts??1));
 }

 async evaluate(deployment:Deployment):Promise<RecoveryRunResult>{
  const active=await this.persistence?.findActive();
  if(active&&active.deploymentCommitSha!==deployment.commitSha){
   throw new Error("Another active recovery belongs to a different deployment.");
  }
  this.rollback.record(deployment);
  const initial=await this.healthProbe.run();

  if(initial.healthy){
   this.audit.record({
    timestamp:new Date().toISOString(),
    actor:this.actor,
    action:"recovery.verified",
    resource:this.resource(deployment),
    result:"verified",
    metadata:{toVersion:deployment.version,toCommitSha:deployment.commitSha,toChecksum:deployment.manifestChecksum,verificationReason:"Initial production health checks passed."}
   });
   return{decision:{action:"keep",target:deployment,requiresVerification:false},audit:this.audit.summarize(this.resource(deployment)),attempts:0};
  }

  const resource=this.resource(deployment);
  await this.persistState(deployment,"checking",0,initial.reason);
  this.audit.record({
   timestamp:new Date().toISOString(),
   actor:this.actor,
   action:"recovery.started",
   resource,
   result:"started",
   metadata:{reason:initial.reason,fromVersion:deployment.version,fromCommitSha:deployment.commitSha,fromChecksum:deployment.manifestChecksum}
  });

  let attempts=0;
  let decision=this.rollback.decide(initial);

  if(decision.action!=="rollback"||!decision.target){
   this.audit.record({
    timestamp:new Date().toISOString(),
    actor:this.actor,
    action:"recovery.halted",
    resource,
    result:"halted",
    metadata:{reason:decision.reason}
   });
   return{decision,audit:this.audit.summarize(resource),attempts};
  }

  while(decision.action==="rollback"&&decision.target&&attempts<this.maxAttempts){
   attempts++;
   const target=decision.target;
   await this.persistState(deployment,"recovering",attempts,decision.reason,target);
   const execution=await this.executor.execute(target);
   if(!execution.success){
    const halted={action:"halt" as const,target,requiresVerification:false,reason:execution.reason??"Rollback execution failed."};
    this.audit.record({
     timestamp:new Date().toISOString(),actor:this.actor,action:"recovery.halted",resource,result:"halted",
     metadata:{reason:halted.reason,toVersion:target.version,toCommitSha:target.commitSha,toChecksum:target.manifestChecksum}
    });
    return{decision:halted,audit:this.audit.summarize(resource),attempts};
   }
   await this.persistState(deployment,"rolled_back",attempts,decision.reason,target);
   this.audit.record({
    timestamp:new Date().toISOString(),
    actor:this.actor,
    action:"recovery.rollback",
    resource,
    result:"rolled_back",
    metadata:{
     reason:decision.reason,
     fromVersion:deployment.version,
     fromCommitSha:deployment.commitSha,
     fromChecksum:deployment.manifestChecksum,
     toVersion:target.version,
     toCommitSha:target.commitSha,
     toChecksum:target.manifestChecksum
    }
   });

   await this.persistState(deployment,"verifying",attempts,undefined,target);
   const verification=await this.healthProbe.run();
   decision=this.rollback.verifyRollback(target,verification);
   if(decision.action==="keep"){
    await this.persistState(deployment,"verified",attempts,verification.reason,target);
    this.audit.record({
     timestamp:new Date().toISOString(),
     actor:this.actor,
     action:"recovery.verified",
     resource,
     result:"verified",
     metadata:{toVersion:target.version,toCommitSha:target.commitSha,toChecksum:target.manifestChecksum,verificationReason:verification.reason??"Post-recovery health checks passed."}
    });
    return{decision,audit:this.audit.summarize(resource),attempts};
   }
  }

  const halted={action:"halt" as const,target:decision.target,requiresVerification:false,reason:"Recovery attempt limit reached or post-recovery verification failed."};
  await this.persistState(deployment,"halted",attempts,halted.reason,decision.target);
  this.audit.record({
   timestamp:new Date().toISOString(),
   actor:this.actor,
   action:"recovery.halted",
   resource,
   result:"halted",
   metadata:{reason:halted.reason}
  });
  return{decision:halted,audit:this.audit.summarize(resource),attempts};
 }

 async report(deployment:Deployment,decision:RecoveryDecision):Promise<RecoveryReport>{
  if(!this.persistence)throw new Error("Recovery persistence is required for a recovery report.");
  const recoveryId=this.recoveryId??"recovery:"+deployment.version+":"+deployment.commitSha;
  const record=await this.persistence.get(recoveryId);
  if(!record)throw new Error("No persisted recovery record is available.");
  const resume=this.resumeEngine.plan(record);
  return createRecoveryReport(deployment,record,decision,this.audit.summarize(this.resource(deployment)),resume);
 }

 async inspectActiveRecovery():Promise<RecoveryResumePlan|undefined>{
  const record=await this.persistence?.findActive();
  return record?this.resumeEngine.plan(record):undefined;
 }

 private async persistState(deployment:Deployment,state:PersistedRecoveryRecord["state"],attempts:number,reason?:string,target?:Deployment):Promise<void>{
  if(!this.persistence)return;
  const recoveryId=this.recoveryId??"recovery:"+deployment.version+":"+deployment.commitSha;
  await this.persistence.save({
   version:1,
   recoveryId,
   deploymentVersion:deployment.version,
   deploymentCommitSha:deployment.commitSha,
   deploymentChecksum:deployment.manifestChecksum,
   state,
   attempts,
   startedAt:new Date().toISOString(),
   updatedAt:new Date().toISOString(),
   targetVersion:target?.version,
   targetCommitSha:target?.commitSha,
   targetChecksum:target?.manifestChecksum,
   reason
  });
 }

 private resource(deployment:Deployment):string{
  return "deployment:"+deployment.version;
 }
}
