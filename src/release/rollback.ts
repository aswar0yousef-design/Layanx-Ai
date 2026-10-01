export interface Deployment{version:string;commitSha:string;manifestChecksum:string;deployedAt:string;}
export interface HealthProbe{healthy:boolean;reason?:string;}
export interface RecoveryDecision{
 action:"keep"|"rollback"|"halt";
 target?:Deployment;
 reason?:string;
 requiresVerification:boolean;
}
export interface RecoveryVerification{healthy:boolean;reason?:string;}

export class RollbackController{
 private readonly deployments:Deployment[]=[];

 record(deployment:Deployment):void{
  this.deployments.push({...deployment});
 }

 lastKnownGood():Deployment|undefined{
  return this.deployments.length>1
   ? this.deployments[this.deployments.length-2]
   : this.deployments[0];
 }

 decide(probe:HealthProbe):RecoveryDecision{
  if(probe.healthy){
   return{action:"keep",target:this.deployments.at(-1),requiresVerification:false};
  }
  const target=this.lastKnownGood();
  if(!target){
   return{action:"halt",requiresVerification:false,reason:probe.reason??"No known-good deployment is available."};
  }
  return{
   action:"rollback",
   target,
   requiresVerification:true,
   reason:probe.reason??"Post-deployment health check failed."
  };
 }

 verifyRollback(target:Deployment|undefined,verification:RecoveryVerification):RecoveryDecision{
  if(!target){
   return{action:"halt",requiresVerification:false,reason:"Rollback target is missing."};
  }
  if(verification.healthy){
   return{action:"keep",target,requiresVerification:false,reason:"Rollback target passed post-recovery health verification."};
  }
  return{
   action:"halt",
   target,
   requiresVerification:false,
   reason:verification.reason??"Rollback target failed post-recovery health verification."
  };
 }
}
