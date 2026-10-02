import {AutonomousRetryPolicy} from "../src/core/autonomous-retry.js";

const policy=new AutonomousRetryPolicy({maxAttempts:3,baseDelayMs:0});
const plan={tool:"http",action:"read",permission:"L1_READ",reason:"safe"} as any;
const transient=policy.decide(plan,{ok:false,missionId:"m",verified:false,error:"HTTP 503 service unavailable",recoverable:true},1);
if(!transient.retry||transient.delayMs!==0)throw new Error("Transient retry was not allowed.");
const terminal=policy.decide(plan,{ok:false,missionId:"m",verified:false,error:"Explicit approval is required",recoverable:false},1);
if(terminal.retry)throw new Error("Non-recoverable failure was retried.");
const modify={...plan,permission:"L3_MODIFY"};
const unsafe=policy.decide(modify,{ok:false,missionId:"m",verified:false,error:"timeout",recoverable:true},1);
if(unsafe.retry)throw new Error("Modification was automatically retried.");
console.log("Autonomous retry tests passed.");
