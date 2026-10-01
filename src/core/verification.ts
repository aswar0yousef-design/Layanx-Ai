import type {Mission} from "./types.js";
import type {VerificationResult} from "./contracts.js";

export class VerificationEngine {
  verify(mission:Mission,result?:unknown,successCriteria:string[]=[]):VerificationResult {
    const failures:string[]=[];
    const checks:string[]=["mission exists","mission has goal","mission has execution plan"];
    if(!mission.goal.trim()) failures.push("Mission goal is empty.");
    if(mission.steps.length===0) failures.push("Mission has no steps.");
    const executionStep=mission.steps.find(step=>/^execute\b/i.test(step.description.trim()));
    if(executionStep && executionStep.status!=="completed") failures.push("Execution step is not completed.");
    if(successCriteria.some(criteria=>!criteria.trim())) failures.push("Success criteria contains an empty item.");
    if(result===null) failures.push("Execution returned a null result.");
    return {verified:failures.length===0,checks,failures};
  }
}
