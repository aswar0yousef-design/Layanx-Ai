import {VerificationEngine,hasExplicitSuccessCriteria} from "../src/core/verification.js";
import type {Mission} from "../src/core/types.js";

function mission(overrides:Partial<Mission>={}):Mission{
 return{
  id:"verification-test",
  goal:"Execute verification test",
  status:"verifying",
  risk:"low",
  requiredPermission:"L1_READ",
  steps:[
   {id:"execute",description:"Run requested action",status:"completed"},
   {id:"verify",description:"Verify result",status:"pending"}
  ],
  createdAt:new Date().toISOString(),
  ...overrides
 };
}

const verifier=new VerificationEngine();

if(!hasExplicitSuccessCriteria(["result.ready === true"]))throw new Error("Explicit result criteria should allow deterministic completion.");
if(hasExplicitSuccessCriteria(["done"]))throw new Error("Generic done criterion must not trigger early deterministic completion.");
if(hasExplicitSuccessCriteria(["finished"]))throw new Error("Descriptive criteria must not trigger early deterministic completion.");
if(hasExplicitSuccessCriteria(["result.ready === true","finished"]))throw new Error("Mixed explicit and descriptive criteria must not trigger early deterministic completion.");

const undefinedResult=verifier.verify(mission(),undefined,[]);
if(undefinedResult.verified||!undefinedResult.failures.includes("Execution returned no result."))throw new Error("Undefined execution result was accepted.");

const missingExecution=verifier.verify(mission({steps:[{id:"plan",description:"Understand goal",status:"completed"}]}),{ok:true},[]);
if(missingExecution.verified||!missingExecution.failures.includes("Mission has no execution step."))throw new Error("Mission without an execution step was accepted.");

const failedExecution=verifier.verify(mission({steps:[{id:"execute",description:"Execute requested action",status:"failed"}]}),{ok:true},[]);
if(failedExecution.verified||!failedExecution.failures.includes("Execution step is not completed."))throw new Error("Failed execution step was accepted.");

const emptyCriterion=verifier.verify(mission(),{ok:true},[""]);
if(emptyCriterion.verified||!emptyCriterion.failures.includes("Success criteria contains an empty item."))throw new Error("Empty success criterion was accepted.");

const nestedPresent=verifier.verify(mission(),{runtime:{status:{state:"ready"}}},["result.runtime.status.state === \"ready\""]);
if(!nestedPresent.verified)throw new Error("Nested result paths were not evaluated: "+nestedPresent.failures.join("; "));

const nestedMissing=verifier.verify(mission(),{ready:true},["result.runtime.status != null"]);
if(nestedMissing.verified)throw new Error("A missing nested result path incorrectly satisfied != null.");
if(!nestedMissing.failures.some(f=>f.includes("Success criterion failed")))throw new Error("Missing nested path did not produce a precise verification failure.");

const nullishAbsent=verifier.verify(mission(),{runtime:{}},["result.runtime.status != null"]);
if(nullishAbsent.verified)throw new Error("undefined != null must fail under nullish comparison semantics.");

const runtimeStatus=verifier.verify(mission(),{system:"LayanX AI",ready:true},["result.ready === true"]);
if(!runtimeStatus.verified)throw new Error("A valid flat runtime.status field was rejected: "+runtimeStatus.failures.join("; "));


console.log("Verification hardening passed.");
