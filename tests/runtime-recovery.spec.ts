import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
import {JsonStorageAdapter} from "../src/storage/json-adapter.js";
import {RuntimeRecoveryManager} from "../src/core/runtime-recovery.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-recovery-"));
const storage=new JsonStorageAdapter(join(dir,"runtime.json"));
const persistence=new RuntimePersistence(new RuntimeStorage(storage));

const original=new LayanXCore();
const mission=original.startMission("resume after crash","recovery-project");
const state=original.executionStates.get(mission.id);
if(!state)throw new Error("Missing execution state.");
original.recovery.checkpoint({missionId:mission.id,stepId:mission.steps[3]?.id??"mission",createdAt:new Date().toISOString(),state:{checkpoint:"before-crash"}});
original.ledger.append({id:"ledger-before",missionId:mission.id,agentId:"agent",action:"before.crash",status:"started",timestamp:new Date().toISOString()});
original.audit.append({timestamp:new Date().toISOString(),actor:"agent",action:"before.crash",resource:mission.id,result:"success",metadata:{missionId:mission.id}});
const replayRequest={missionId:mission.id,agentId:"agent",tool:"echo",action:"echo",permission:"L1_READ" as const,idempotencyKey:"recovery-test-key",payload:"resumed"};
const replayClaim=await original.idempotency.begin(replayRequest);
if(!replayClaim.accepted)throw new Error("Could not seed completed idempotency record.");
await original.idempotency.complete(replayRequest.idempotencyKey,"resumed");

await persistence.save({
  mission,
  executionState:state,
  ledger:original.ledger.forMission(mission.id),
  audit:original.audit.forMission(mission.id),
  checkpoint:original.recovery.restore(mission.id),
  idempotency:await original.idempotency.list(),
  savedAt:new Date().toISOString(),
  schemaVersion:1
});

const restoredCore=new LayanXCore();
restoredCore.registerAgent({agentId:"agent",purpose:"recovery",allowedTools:["echo"],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["echo"],stopCondition:"stop"});
restoredCore.tools.register({name:"echo",description:"recovery echo",permission:"L1_READ",dangerous:false});
const recoveryCapability=restoredCore.capabilities.issue({
  missionId:mission.id,agentId:"agent",projectId:"recovery-project",resource:"echo",
  permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()
});
const recovery=new RuntimeRecoveryManager(persistence,restoredCore);
const badRequest={missionId:mission.id,agentId:"missing-agent",tool:"missing-tool",action:"echo",permission:"L1_READ" as const,idempotencyKey:"bad-recovery-key",payload:"blocked"};
try{
  await recovery.resume(mission.id,badRequest,{execute:async request=>request.payload});
  throw new Error("Recovery readiness accepted an unavailable agent/tool.");
}catch(error){
  if(!(error instanceof Error)||!error.message.includes("Recovery readiness failed"))throw error;
}
const report=await recovery.report(mission.id,badRequest);
if(report.readiness.ready)throw new Error("Recovery report incorrectly marked an invalid request as ready.");
if(!report.readiness.issues.some(issue=>issue.code==="AGENT_UNAVAILABLE"))throw new Error("Recovery report omitted agent readiness issue.");
const candidates=await recovery.inspect();
if(candidates.length!==1||candidates[0]?.missionId!==mission.id)throw new Error("Persisted recovery candidate was not discovered.");

let calls=0;
const result=await recovery.resume(
  mission.id,
  replayRequest,
  {execute:async request=>{calls++;return request.payload;}},
  undefined,
  {projectId:"recovery-project",capabilityId:recoveryCapability.id}
);
if(!result.ok||!result.verified)throw new Error(result.error??"Recovery resume failed.");
if(mission.steps[3]?.status!=="completed")throw new Error("Recovery did not resume through the execution step.");
if(calls!==0)throw new Error("Persisted idempotency record was not replayed safely after recovery.");

const after=await persistence.get(mission.id);
if(!after)throw new Error("Recovered snapshot missing.");
if(after.ledger.length<2)throw new Error("Ledger history was lost during recovery.");
if(!after.audit.some(x=>x.action==="before.crash"))throw new Error("Audit history was lost during recovery.");
if(after.checkpoint?.state===undefined)throw new Error("Checkpoint was not restored.");
if(after.executionState.status!=="completed")throw new Error("Recovered execution state was not completed.");
if(after.idempotency?.find(record=>record.key===replayRequest.idempotencyKey)?.status!=="completed")throw new Error("Recovered idempotency state was not preserved.");

await rm(dir,{recursive:true,force:true});
console.log("Runtime recovery hydration test passed.");
