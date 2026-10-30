/**
 * Outcome gates for autonomous jobs. Deliberately independent of an LLM's
 * "done" response. This report proves only the enumerated machine checks;
 * natural-language acceptance criteria remain listed, not silently certified.
 */
export interface OutcomeCheck {name:string;ok:boolean;skipped?:boolean;summary:string}
export interface OutcomeRuntimeProof {missionId:string;milestone:string;observedAt:string}
export interface OutcomeBrowserProof {url:string;ok:boolean;viewports:string[];problems:string[]}
export interface OutcomeSecurityProof {score:number;blocked:boolean}

export interface OutcomeEvidence {
  kind:"check"|"runtime"|"browser"|"security";
  name:string;
  passed:boolean;
  observedAt:string;
  reference:string;
  detail:string;
}
export interface OutcomeReport {
  version:1;
  jobId:string;
  projectId:string;
  /** These are planner expectations, not automatically certified assertions. */
  acceptanceCriteria:string[];
  verificationScope:"automated-gates";
  status:"verified"|"blocked";
  evidence:OutcomeEvidence[];
  blockers:string[];
  createdAt:string;
}
export interface OutcomeInput {
  jobId:string;
  projectId:string;
  acceptanceCriteria:string[];
  codeTask:boolean;
  checks:OutcomeCheck[];
  requiredChecks?:string[];
  runtimeProofs:OutcomeRuntimeProof[];
  browserRequired:boolean;
  browser?:OutcomeBrowserProof;
  securityRequired:boolean;
  security?:OutcomeSecurityProof;
  observedAt?:string;
}

/** Skip is never proof. Tool output, tests and browser failures are hard blockers. */
export function assessOutcome(input:OutcomeInput):OutcomeReport {
  const at=input.observedAt??new Date().toISOString();
  const evidence:OutcomeEvidence[]=[];
  const blockers:string[]=[];
  for(const check of input.checks){
    if(check.skipped)continue;
    evidence.push({kind:"check",name:check.name,passed:check.ok,observedAt:at,
      reference:"project.run:"+check.name,detail:check.summary.slice(0,1200)});
    if(!check.ok)blockers.push("Failed check: "+check.name);
  }
  for(const proof of input.runtimeProofs){
    if(!proof.missionId.trim())continue;
    evidence.push({kind:"runtime",name:proof.milestone,passed:true,observedAt:proof.observedAt,
      reference:"mission:"+proof.missionId,detail:"Runtime reported a completed mission; this alone does not prove the goal."});
  }
  if(input.browser){
    evidence.push({kind:"browser",name:"browser.test",passed:input.browser.ok,observedAt:at,
      reference:input.browser.url,detail:input.browser.problems.slice(0,5).join("; ")||"Browser test passed"});
    if(!input.browser.ok)blockers.push("Browser verification failed.");
  }
  if(input.security){
    evidence.push({kind:"security",name:"project.security",passed:!input.security.blocked,observedAt:at,
      reference:"security:score",detail:"score "+input.security.score});
    if(input.security.blocked)blockers.push("Security verification blocked.");
  }
  if(input.browserRequired&&!input.browser)blockers.push("Required browser verification has no evidence.");
  if(input.securityRequired&&!input.security)blockers.push("Required security scan has no evidence.");
  for(const name of input.requiredChecks??[]){
    if(!input.checks.some(c=>c.name===name&&c.ok&&!c.skipped))blockers.push("Required check has no successful non-skipped evidence: "+name);
  }
  const machineProof=evidence.some(e=>e.passed&&((e.kind==="check"&&["test","build","typecheck","lint"].includes(e.name))||e.kind==="browser"));
  if(input.codeTask&&!machineProof)blockers.push("Code work has no successful non-skipped build, typecheck, test or browser proof.");
  if(!input.codeTask&&!evidence.some(e=>e.passed))blockers.push("No successful runtime or tool evidence for this task.");
  return {version:1,jobId:input.jobId,projectId:input.projectId,
    acceptanceCriteria:input.acceptanceCriteria.map(x=>x.slice(0,500)),
    verificationScope:"automated-gates",status:blockers.length?"blocked":"verified",
    evidence,blockers,createdAt:at};
}
