/**
 * Pure release-gate evaluation. Never allow a model's statement or an agent's
 * "completed" response to replace independently measured machine evidence.
 */
export interface LocalAcceptanceObserved {
  id?:string;
  jobId?:string;
  workspace?:string;
  ok?:boolean;
  status?:string;
  hasProject?:boolean;
  hasDelivery?:boolean;
  checkRefs?:string[];
  independentUI?:{
    ok?:boolean;
    checks?:Array<{name:string;ok:boolean}>;
    blockers?:string[];
  };
  independentBehavior?:{
    ok?:boolean;
    checks?:Array<{name:string;ok:boolean}>;
    blockers?:string[];
  };
}
export interface IntegrityObserved {
  ok:boolean;
  jobId:string;
  projectRoot:string;
  checkedFiles:number;
  blockers:string[];
  warnings:string[];
}
export interface LocalAcceptanceGate {
  ok:boolean;
  blockers:string[];
  independentChecksPassed:number;
  filesVerified:number;
}
const REQUIRED_BEHAVIOR=[
  "start","health","bilingual-home","create-task","list-task","restart",
  "persistent-create","delete-task","restart-after-delete","persistent-delete"
] as const;
const REQUIRED_REFERENCES=[
  "project.run:test","project.run:build","independent:http:task-app"
] as const;
export function evaluateLocalAcceptance(
  observed:LocalAcceptanceObserved|null,
  integrity:IntegrityObserved|null,
  expectedWorkspace:string,
):LocalAcceptanceGate{
  const blockers:string[]=[];
  if(!observed){return {ok:false,blockers:["Acceptance result is missing or invalid"],independentChecksPassed:0,filesVerified:0};}
  if(observed.ok!==true||observed.status!=="completed")blockers.push("Live agent outcome did not complete successfully");
  if(observed.hasProject!==true)blockers.push("Required application files were not generated");
  if(observed.hasDelivery!==true)blockers.push("Delivery files were not created");
  if(observed.workspace!==expectedWorkspace)blockers.push("Acceptance workspace does not match the isolated run folder");
  const refs=new Set(Array.isArray(observed.checkRefs)?observed.checkRefs:[]);
  for(const ref of REQUIRED_REFERENCES)if(!refs.has(ref))blockers.push("Missing machine evidence: "+ref);
  const behavior=observed.independentBehavior;
  const checks=Array.isArray(behavior?.checks)?behavior.checks:[];
  const counts=new Map<string,number>();
  for(const c of checks)if(c&&c.ok===true)counts.set(c.name,(counts.get(c.name)??0)+1);
  for(const name of REQUIRED_BEHAVIOR)if(counts.get(name)!==1)blockers.push("Independent behavioral probe not proven: "+name);
  if(behavior?.ok!==true||checks.length!==REQUIRED_BEHAVIOR.length)
    blockers.push("Independent app behavior was not fully verified");
  const requiredUI=["browser-start","desktop-create","desktop-reload","desktop-delete","desktop-delete-reload",
    "mobile-create","mobile-reload","mobile-delete","mobile-delete-reload"];
  const ui=observed.independentUI;
  const uiChecks=Array.isArray(ui?.checks)?ui.checks:[];
  const uiCounts=new Map<string,number>();
  for(const c of uiChecks)if(c&&c.ok===true)uiCounts.set(c.name,(uiCounts.get(c.name)??0)+1);
  for(const name of requiredUI)if(uiCounts.get(name)!==1)
    blockers.push("Real-browser interaction not independently proven: "+name);
  if(ui?.ok!==true||uiChecks.length!==requiredUI.length)
    blockers.push("Desktop/mobile browser UI verification did not fully pass");
  const projectRoot=integrity?.projectRoot;
  if(!integrity?.ok||integrity.jobId!==observed.jobId||projectRoot!==expectedWorkspace)
    blockers.push("Offline artifact integrity did not match the accepted project/job");
  if(integrity?.blockers?.length)blockers.push(...integrity.blockers.map(x=>"Delivery: "+x));
  if(integrity?.warnings?.length)blockers.push(...integrity.warnings.map(x=>"Unverified artifact: "+x));
  return {ok:blockers.length===0,blockers,independentChecksPassed:REQUIRED_BEHAVIOR.filter(n=>counts.get(n)===1).length,
    filesVerified:integrity?.checkedFiles??0};
}
export interface LocalAcceptanceRecord{
  runFolder:string;
  workspace:string;
  exitCode:number|null;
  observed:LocalAcceptanceObserved|null;
  integrity:IntegrityObserved|null;
  evaluation:LocalAcceptanceGate;
}
export function summarizeLocalAcceptance(
  records:LocalAcceptanceRecord[],
  requestedRuns:number
):{
  ok:boolean;requestedRuns:number;completedRuns:number;passed:number;failed:number;
  duplicatedJobs:string[];blockers:string[];
}{
  const blockers:string[]=[];
  if(!Number.isInteger(requestedRuns)||requestedRuns<1||requestedRuns>5)blockers.push("Run count must be 1 to 5");
  if(records.length!==requestedRuns)blockers.push("Not all requested runs produced results");
  const jobIds=new Set<string>(),workspaces=new Set<string>(),duplicatedJobs:string[]=[];
  let passed=0;
  for(const [i,r] of records.entries()){
    if(r.exitCode!==0||!r.evaluation.ok)blockers.push("Run "+(i+1)+" did not pass independent acceptance and integrity gates");
    else passed++;
    if(r.observed?.jobId){
      if(jobIds.has(r.observed.jobId))duplicatedJobs.push(r.observed.jobId);
      jobIds.add(r.observed.jobId);
    }
    if(workspaces.has(r.workspace))blockers.push("Duplicate project workspace: "+r.workspace);
    workspaces.add(r.workspace);
  }
  if(duplicatedJobs.length)blockers.push("Repeated job IDs across supposedly isolated runs");
  return {ok:blockers.length===0,requestedRuns,completedRuns:records.length,passed,
    failed:records.length-passed,duplicatedJobs,blockers};
}
