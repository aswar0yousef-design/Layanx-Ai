import {ReleaseHealthProbe} from "./health-probe.js";
import {RollbackController, type Deployment, type RecoveryDecision} from "./rollback.js";
import {RecoveryAuditTrail} from "./recovery-audit.js";

export interface RecoveryRunResult{
 decision:RecoveryDecision;
 audit:ReturnType<RecoveryAuditTrail["summarize"]>;
 attempts:number;
}

export interface RecoveryControllerOptions{
 actor?:string;
 maxAttempts?:number;
}

export class ProductionRecoveryController{
 private readonly actor:string;
 private readonly maxAttempts:number;

 constructor(
  private readonly healthProbe:ReleaseHealthProbe,
  private readonly rollback:RollbackController,
  private readonly audit:RecoveryAuditTrail,
  options:RecoveryControllerOptions={}
 ){
  this.actor=options.actor??"release-controller";
  this.maxAttempts=Math.max(1,Math.floor(options.maxAttempts??1));
 }

 async evaluate(deployment:Deployment):Promise<RecoveryRunResult>{
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

   const verification=await this.healthProbe.run();
   decision=this.rollback.verifyRollback(target,verification);
   if(decision.action==="keep"){
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

 private resource(deployment:Deployment):string{
  return "deployment:"+deployment.version;
 }
}
