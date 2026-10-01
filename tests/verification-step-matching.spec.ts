import {VerificationEngine} from "../src/core/verification.js";
const mission={id:"m",goal:"g",status:"verifying",requiredPermission:"L1_READ" as const,steps:[{id:"x",description:"Execute the selected tool",status:"completed" as const},{id:"v",description:"Verify result",status:"pending" as const}]};
const result=new VerificationEngine().verify(mission,"ok",[]);
if(!result.verified)throw new Error(result.failures.join("; "));
console.log("Execution-step verification test passed.");