/** Deterministic, fail-closed acceptance evidence. Never trust a model's "done" message. */
export interface AcceptanceRequirement {
  id:string;
  description:string;
  required:boolean;
  /** Optional independent check to observe during final verification. */
  checkId?: "test"|"build"|"typecheck"|"lint"|"independent:task-app-http-v1";
  /** Existing project-relative output file that the check is expected to certify. */
  artifact?:string;
}
export interface AcceptanceProof {
  requirementId:string;
  checkId:string;
  passed:boolean;
  skipped?:boolean;
  observedAt:string;
  artifact?:string;
  /** Source revision that was actually tested; prevents stale proof after edits. */
  revision?:string;
}
export interface AcceptanceVerdict {
  status:"verified"|"blocked";
  passed:string[];
  blockers:string[];
}
/** A requirement passes only with a real, non-skipped, named check and artifact. */
export function evaluateAcceptance(requirements:readonly AcceptanceRequirement[], proofs:readonly AcceptanceProof[],currentRevision?:string):AcceptanceVerdict {
  const blockers:string[]=[];
  const passed:string[]=[];
  const seen=new Set<string>();
  if(!requirements.length)blockers.push("No acceptance requirements defined.");
  if(requirements.length&&!requirements.some(r=>r.required))blockers.push("No required acceptance criteria defined.");
  for(const requirement of requirements){
    if(!requirement.id.trim()||!requirement.description.trim()||seen.has(requirement.id)){
      blockers.push("Invalid or duplicate requirement ID: "+requirement.id);
      continue;
    }
    seen.add(requirement.id);
    if(!requirement.required)continue;
    const matching=proofs.filter(p=>p.requirementId===requirement.id);
    const good=matching.some(p=>p.passed&&!p.skipped&&p.checkId.trim()&&p.artifact?.trim()&&Number.isFinite(Date.parse(p.observedAt))&&(!currentRevision||p.revision===currentRevision));
    if(matching.some(p=>!p.passed&&!p.skipped))blockers.push("Failed required acceptance: "+requirement.id);
    else if(!good)blockers.push("Missing independent acceptance proof: "+requirement.id);
    else passed.push(requirement.id);
  }
  return {status:blockers.length?"blocked":"verified",passed,blockers};
}
