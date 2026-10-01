export interface Deployment{version:string;commitSha:string;manifestChecksum:string;deployedAt:string;}
export interface HealthProbe{healthy:boolean;reason?:string;}
export class RollbackController{
 private readonly deployments:Deployment[]=[];
 record(deployment:Deployment){this.deployments.push(deployment);}
 lastKnownGood(){return this.deployments.length>1?this.deployments[this.deployments.length-2]:this.deployments[0];}
 decide(probe:HealthProbe){if(probe.healthy)return{action:"keep",target:this.deployments.at(-1)} as const;const target=this.lastKnownGood();if(!target)return{action:"halt"} as const;return{action:"rollback",target,reason:probe.reason??"Post-deployment health check failed."} as const;}
}
