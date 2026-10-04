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
  if(active)return this.resumeActiveRecovery(deployment);

  this.rollback.record(deployment);
  const initial=await this.healthProbe.run();

  if(initial.healthy){
   this.audit.record({
    timestamp:new Date().toISOString(),actor:this.actor,action:"recovery.verified",
    resource:this.resource(deployment),result:"verified",
    metadata:{toVersion:deployment.version,toCommitSha:deployment.commitSha,toChecksum:deployment.manifestChecksum,verificationReason:"Initial production health checks passed."}
   });
   return{decision:{action:"keep",target:deployment,requiresVerification:false},audit:this.audit.summarize(this.resource(deployment)),attempts:0};
  }

  const resource=this.resource(deployment);
  await this.persistState(deployment,"checking",0,initial.reason);
  this.audit.record({
   timestamp:new Date().toISOString(),actor:this.actor,action:"recovery.started",resource,result:"started",
   metadata:{reason:initial.reason,fromVersion:deployment.version,fromCommitSha:deployment.commitSha,fromChecksum:deployment.manifestChecksum}
  });

  let attempts=0;
  let decision=this.rollback.decide(initial);

  if(decision.action!=="rollback"||!decision.target){
   await this.persistState(deployment,"halted",0,decision.reason);
   this.audit.record({
    timestamp:new Date().toISOString(),actor:this.actor,action:"recovery.halted",resource,result:"halted",
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
    await this.persistState(deployment,"halted",attempts,halted.reason,target);
    this.audit.record({
     timestamp:new Date().toISOString(),actor:this.actor,action:"recovery.halted",resource,result:"halted",
     metadata:{reason:halted.reason,toVersion:target.version,toCommitSha:target.commitSha,toChecksum:target.manifestChecksum}
    });
    return{decision:halted,audit:this.audit.summarize(resource),attempts};
   }
   await this.persistState(deployment,"rolled_back",attempts,decision.reason,target);
   this.audit.record({
    timestamp:new Date().toISOString(),actor:this.actor,action:"recovery.rollback",resource,result:"rolled_back",
    metadata:{reason:decision.reason,fromVersion:deployment.version,fromCommitSha:deployment.commitSha,fromChecksum:deployment.manifestChecksum,toVersion:target.version,toCommitSha:target.commitSha,toChecksum:target.manifestChecksum}
   });

   await this.persistState(deployment,"verifying",attempts,undefined,target);
   const verification=await this.healthProbe.run();
   decision=this.rollback.verifyRollback(target,verification);
   if(decision.action==="keep"){
    await this.persistState(deployment,"verified",attempts,verification.reason,target);
    this.audit.record({
     timestamp:new Date().toISOString(),actor:this.actor,action:"recovery.verified",resource,result:"verified",
     metadata:{toVersion:target.version,toCommitSha:target.commitSha,toChecksum:target.manifestChecksum,verificationReason:verification.reason??"Post-recovery health checks passed."}
    });
    return{decision,audit:this.audit.summarize(resource),attempts};
   }
  }

  const halted={action:"halt" as const,target:decision.target,requiresVerification:false,reason:"Recovery attempt limit reached or post-recovery verification failed."};
  await this.persistState(deployment,"halted",attempts,halted.reason,decision.target);
  this.audit.record({
   timestamp:new Date().toISOString(),actor:this.actor,action:"recovery.halted",resource,result:"halted",
   metadata:{reason:halted.reason}
  });
  return{decision:halted,audit:this.audit.summarize(resource),attempts};
 }

 async resumeActiveRecovery(deployment:Deployment):Promise<RecoveryRunResult>{
  if(!this.persistence)throw new Error("Recovery persistence is required to resume recovery.");
  const record=await this.persistence.findActive();
  if(!record)return{decision:{action:"keep",target:deployment,requiresVerification:false,reason:"No active recovery requires resumption."},audit:this.audit.summarize(this.resource(deployment)),attempts:0};
  if(record.deploymentCommitSha!==deployment.commitSha)throw new Error("Active recovery belongs to a different deployment.");
  const plan=this.resumeEngine.plan(record);
  if(plan.action==="halt")return{decision:{action:"halt",target:plan.target,requiresVerification:false,reason:plan.reason},audit:this.audit.summarize(this.resource(deployment)),attempts:record.attempts};
  const target=plan.target;
  if(plan.action==="complete"&&target)return{decision:{action:"keep",target,requiresVerification:false,reason:"Recovery was already verified."},audit:this.audit.summarize(this.resource(deployment)),attempts:record.attempts};

  const verification=await this.healthProbe.run();
  if(verification.healthy){
   const verifiedTarget=target??deployment;
   const reason=target?"Resumed recovery target passed health verification.":"Current deployment passed health verification after recovery was interrupted during checking.";
   await this.persistState(deployment,"verified",record.attempts,verification.reason??reason,verifiedTarget);
   this.audit.record({
    timestamp:new Date().toISOString(),actor:this.actor,action:"recovery.verified",resource:this.resource(deployment),result:"verified",
    metadata:{toVersion:verifiedTarget.version,toCommitSha:verifiedTarget.commitSha,toChecksum:verifiedTarget.manifestChecksum,verificationReason:verification.reason??reason}
   });
   return{decision:{action:"keep",target:verifiedTarget,requiresVerification:false,reason},audit:this.audit.summarize(this.resource(deployment)),attempts:record.attempts};
  }

  const reason=verification.reason??"Resumed recovery health verification failed; automatic rollback replay is unsafe.";
  await this.persistState(deployment,"halted",record.attempts,reason,target);
  this.audit.record({timestamp:new Date().toISOString(),actor:this.actor,action:"recovery.halted",resource:this.resource(deployment),result:"halted",metadata:{reason,toVersion:target?.version,toCommitSha:target?.commitSha,toChecksum:target?.manifestChecksum}});
  return{decision:{action:"halt",target,requiresVerification:false,reason},audit:this.audit.summarize(this.resource(deployment)),attempts:record.attempts};
 }

 async report(deployment:Deployment,decision:RecoveryDecision):Promise<RecoveryReport>{
  if(!this.persistence)throw new Error("Recovery persistence is required for a recovery report.");
  const recoveryId=this.recoveryId??"recovery:"+deployment.version+":"+deployment.commitSha;
  const record=await this.persistence.get(recoveryId);
  if(!record)throw new Error("No persisted recovery record is available.");
  const resume=this.resumeEngine.plan(record);
  return createRecoveryReport(deployment,record,decision,this.audit.summarize(this.resource(deployment)),resume);
 }

 async history(limit=50):Promise<PersistedRecoveryRecord[]>{
  if(!this.persistence)throw new Error("Recovery persistence is required for recovery history.");
  return this.persistence.history(limit);
 }

 async inspectActiveRecovery():Promise<RecoveryResumePlan|undefined>{
  if(!this.persistence)return undefined;
  const record=await this.persistence.findActive();
  if(record)return this.resumeEngine.plan(record);
  const history=await this.persistence.history(1);
  const latest=history[0];
  const plan=latest?this.resumeEngine.plan(latest):undefined;
  return plan?.action==="complete"?plan:undefined;
 }

 private async persistState(deployment:Deployment,state:PersistedRecoveryRecord["state"],attempts:number,reason?:string,target?:Deployment):Promise<void>{
  if(!this.persistence)return;
  const recoveryId=this.recoveryId??"recovery:"+deployment.version+":"+deployment.commitSha;
  await this.persistence.save({
   version:1,recoveryId,deploymentVersion:deployment.version,deploymentCommitSha:deployment.commitSha,
   deploymentChecksum:deployment.manifestChecksum,state,attempts,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),
   targetVersion:target?.version,targetCommitSha:target?.commitSha,targetChecksum:target?.manifestChecksum,reason
  });
 }

 private resource(deployment:Deployment):string{return "deployment:"+deployment.version;}
}
