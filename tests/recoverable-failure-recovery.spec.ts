import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
import {JsonStorageAdapter} from "../src/storage/json-adapter.js";
import {RuntimeRecoveryManager} from "../src/core/runtime-recovery.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-recoverable-failure-"));
const persistence=new RuntimePersistence(new RuntimeStorage(new JsonStorageAdapter(join(dir,"runtime.json"))));
const core=new LayanXCore();
const agent={agentId:"recovery-agent",purpose:"resume recoverable failures",allowedTools:["echo"],forbiddenResources:[],requiredPermission:"L1_READ" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["echo"],stopCondition:"stop"};
core.registerAgent(agent);
core.tools.register({name:"echo",description:"Echo",permission:"L1_READ",dangerous:false});

const mission=core.startMission("recover a transient failure","recovery-project");
mission.requiredPermission="L1_READ";
mission.steps=[{id:"execute",description:"Execute echo",status:"pending"}];
mission.tools=[{tool:"echo",action:"echo",permission:"L1_READ",reason:"recover"}];
core.missions.save(mission);

const capability=core.capabilities.issue({missionId:mission.id,agentId:agent.agentId,projectId:"recovery-project",resource:"echo",permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()});
const request={missionId:mission.id,agentId:agent.agentId,tool:"echo",action:"echo",permission:"L1_READ" as const,idempotencyKey:"recoverable-failure-key",payload:"ok",planIndex:0};

const failed=await core.executionRuntime.run(mission,request,{execute:async()=>{throw new Error("transient");}},undefined,{projectId:"recovery-project",capabilityId:capability.id},{deferVerification:true});
if(failed.ok||!failed.recoverable)throw new Error("Transient failure was not marked recoverable.");
if(mission.status!=="failed")throw new Error("Transient failure did not persist failed mission status.");

await persistence.saveAtomic({
 mission,
 executionState:core.executionStates.get(mission.id)!,
 ledger:core.ledger.forMission(mission.id),
 audit:core.audit.forMission(mission.id),
 checkpoint:core.recovery.restore(mission.id),
 idempotency:await core.idempotency.list(),
 memory:core.memory.list().filter(entry=>entry.missionId===mission.id),
 handoffs:core.handoffs.forMission(mission.id),
 delegatedTasks:core.delegation.forMission(mission.id),
 nextAction:core.nextAction.decide({mission,tasks:core.delegation.forMission(mission.id),handoffs:core.handoffs.forMission(mission.id)}),
 savedAt:new Date().toISOString(),schemaVersion:1
});

const restored=new LayanXCore();
restored.registerAgent(agent);
restored.tools.register({name:"echo",description:"Echo",permission:"L1_READ",dangerous:false});
const restoredCapability=restored.capabilities.issue({missionId:mission.id,agentId:agent.agentId,projectId:"recovery-project",resource:"echo",permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()});
const recovery=new RuntimeRecoveryManager(persistence,restored);
const candidates=await recovery.inspect();
if(candidates.length!==1||candidates[0]?.missionId!==mission.id)throw new Error("Recoverable failed mission was not discovered.");

let calls=0;
const resumed=await recovery.resume(mission.id,request,{execute:async()=>{calls++;return"ok";}},undefined,{projectId:"recovery-project",capabilityId:restoredCapability.id});
if(!resumed.ok||!resumed.verified)throw new Error(resumed.error??"Recoverable failure did not resume.");
if(restored.missions.get(mission.id)?.status!=="completed")throw new Error("Recovered mission was not restored into MissionStore.");
if(calls!==1)throw new Error("Recovery executed an unexpected number of calls.");
const after=await persistence.get(mission.id);
if(!after||after.mission.status!=="completed"||after.executionState.status!=="completed"||after.executionState.recoverable)throw new Error("Recovered mission did not reach a non-recoverable completed state.");

await rm(dir,{recursive:true,force:true});
console.log("Recoverable failure crash-boundary test passed.");
