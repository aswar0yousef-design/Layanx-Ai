import type {ReleaseEvidence} from "./release-gate.js";
import {ReleaseGate} from "./release-gate.js";
import {createReleaseManifest} from "./release-manifest.js";
export class PromotionController{
 constructor(private readonly gate=new ReleaseGate()){}
 promote(evidence:ReleaseEvidence,artifacts:string[]){
  const decision=this.gate.evaluate(evidence);
  if(!decision.allowed)throw new Error("Release blocked: "+decision.reasons.join(" "));
  return createReleaseManifest({version:evidence.version,commitSha:evidence.commitSha,artifacts});
 }
}
