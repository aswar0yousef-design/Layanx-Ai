import type {MissionToolPlan,PermissionLevel} from "./types.js";
import type {RuntimeResult} from "./runtime.js";

const rank:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};

export interface RetryDecision{
  retry:boolean;
  delayMs:number;
  reason:string;
}

export interface RetryPolicyOptions{
  maxAttempts?:number;
  baseDelayMs?:number;
  maxDelayMs?:number;
}

export class AutonomousRetryPolicy{
  readonly maxAttempts:number;
  readonly baseDelayMs:number;
  readonly maxDelayMs:number;
  constructor(options:RetryPolicyOptions={}){
    this.maxAttempts=Math.min(Math.max(Math.floor(options.maxAttempts??3),1),5);
    this.baseDelayMs=Math.max(0,Math.floor(options.baseDelayMs??250));
    this.maxDelayMs=Math.max(this.baseDelayMs,Math.floor(options.maxDelayMs??2000));
  }

  decide(plan:MissionToolPlan,result:RuntimeResult,attempt:number):RetryDecision{
    if(result.ok)return{retry:false,delayMs:0,reason:"Execution succeeded."};
    if(attempt>=this.maxAttempts)return{retry:false,delayMs:0,reason:"Retry limit exhausted."};
    if(result.recoverable===false)return{retry:false,delayMs:0,reason:"Failure is not recoverable."};
    if(rank[plan.permission]>2)return{retry:false,delayMs:0,reason:"Automatic retry is restricted to read/analyze operations."};
    if(this.isTransient(result.error))return{retry:true,delayMs:Math.min(this.baseDelayMs*Math.pow(2,attempt-1),this.maxDelayMs),reason:"Transient failure is eligible for bounded retry."};
    return{retry:false,delayMs:0,reason:"Failure does not match a transient retry category."};
  }

  private isTransient(error?:string):boolean{
    const value=(error??"").toLowerCase();
    if(!value)return false;
    return /(timeout|timed out|temporar|try again|rate.?limit|too many requests|\b429\b|\b502\b|\b503\b|\b504\b|econnreset|etimedout|eai_again|network|service unavailable|connection reset|gateway)/i.test(value);
  }
}
