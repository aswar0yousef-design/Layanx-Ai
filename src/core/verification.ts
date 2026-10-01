import type {Mission} from "./types.js";
import type {VerificationResult} from "./contracts.js";

export class VerificationEngine {
  verify(mission:Mission):VerificationResult {
    const failures:string[]=[];
    const checks:string[]=["mission exists","mission has goal","mission has execution plan"];
    if(!mission.goal.trim()) failures.push("Mission goal is empty.");
    if(mission.steps.length===0) failures.push("Mission has no steps.");
    return {verified:failures.length===0,checks,failures};
  }
}
