import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {MissionRunner} from "../src/core/mission-runner.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
import {RuntimeRecoveryManager} from "../src/core/runtime-recovery.js";
import {Replanner} from "../src/core/replan.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-recovery-cycle-"));
const storage=RuntimeStorage.json(join(dir,"runtime.json"));
const persistence=new RuntimePersistence(storage);

function register(core:LayanXCore){
 const a={agentId:"agent-a",purpose:"recover initial execution",allowedTools:["terminal.run"],forbiddenResources:[],requiredPermission:"L4_EXECUTE" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
 const b={agentId:"agent-b",purpose:"execute handoff",allowedTools:["terminal.run"],forbiddenResources:[],requiredPermission:"L4_EXECUTE" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
 core.registerAgent(a);core.registerAgent(b);
 core.tools.register({name:"terminal.run",description:"Run command",permission:"L4_EXECUTE",dangerous:true});
 return{a,b};
}

const core1=new LayanXCore(undefined,persistence);
const {a,b}=register(core1);
const mission=core1.startMission("Recover, handoff and complete");
mission.requiredPermission="L4_EXECUTE";
mission.steps=[
 {id:"prepare",description:"Prepare context",status:"completed"},
 {id:"execute",description:"Execute command",status:"pending"},
 {id:"verify",description:"Verify result",status:"pending"}
];

const cap1=core1.capabilities.issue({missionId:mission.id,agentId:a.agentId,projectId:"recovery-project",resource:"terminal.run",permission:"L4_EXECUTE",expiresAt:new Date(Date.now()+60000).toISOString()});
const runner1=new MissionRunner(core1);
let firstCalls=0;
const failed=await runner1.execute(mission,{
 missionId:mission.id,agentId:a.agentId,tool:"terminal.run",action:"run command",permission:"L4_EXECUTE",idempotencyKey:"recovery-cycle",payload:{command:"echo first"}
},{async execute(){firstCalls++;throw new Error("simulated crash before retry");}},undefined,{projectId:"recovery-project",capabilityId:cap1.id});
if(failed.ok||!failed.recoverable||firstCalls!==1)throw new Error("Initial recoverable failure was not captured.");

const persistedAfterReplan=await persistence.get(mission.id);
if(!persistedAfterReplan||persistedAfterReplan.executionState.status!=="running")throw new Error("Replanned retry state was not persisted as resumable.");
if(persistedAfterReplan.idempotency?.find(r=>r.key==="recovery-cycle")?.status!=="failed")throw new Error("Failed idempotency attempt was not persisted.");

const handoff=core1.handoffs.create({
 missionId:mission.id,fromAgentId:a.agentId,toAgent:b,goal:"Execute the recovered workflow",
 context:{recoveredFrom:"recovery-cycle"},
 execution:{action:"run command after recovery",tool:"terminal.run",payload:{command:"echo recovered"}},
 requiredPermission:"L4_EXECUTE"
});
await core1.executionRuntime.persist(mission);

const core2=new LayanXCore(undefined,persistence);
const {b:b2}=register(core2);
const cap2=core2.capabilities.issue({missionId:mission.id,agentId:a.agentId,projectId:"recovery-project",resource:"terminal.run",permission:"L4_EXECUTE",expiresAt:new Date(Date.now()+60000).toISOString()});
const recovery=new RuntimeRecoveryManager(persistence,core2);
const report=await recovery.report(mission.id,{missionId:mission.id,agentId:a.agentId,tool:"terminal.run",action:"run command",permission:"L4_EXECUTE",idempotencyKey:"recovery-cycle:retry:1",payload:{command:"echo recovered"}});
if(!report.readiness.ready||!report.nextAction.includes("Ready to resume"))throw new Error("Persisted replanned mission was not recovery-ready.");

let recoveryCalls=0;
const resumed=await recovery.resume(mission.id,{
 missionId:mission.id,agentId:a.agentId,tool:"terminal.run",action:"run command",permission:"L4_EXECUTE",idempotencyKey:"recovery-cycle:retry:1",payload:{command:"echo recovered"}
},{async execute(){recoveryCalls++;return{done:true,stage:"recovered"};}},undefined,{projectId:"recovery-project",capabilityId:cap2.id});
if(!resumed.ok||!resumed.verified||recoveryCalls!==1)throw new Error("Recovery did not complete exactly one retry execution.");

const restoredHandoff=core2.handoffs.get(handoff.id);
if(restoredHandoff.status!=="pending")throw new Error("Persisted handoff was not restored after crash.");
const capB=core2.capabilities.issue({missionId:mission.id,agentId:b2.agentId,projectId:"recovery-project",resource:"terminal.run",permission:"L4_EXECUTE",expiresAt:new Date(Date.now()+60000).toISOString()});
const runner2=new MissionRunner(core2);
const handoffResult=await runner2.executeHandoff(mission,restoredHandoff,{async execute(){return{done:true,stage:"handoff"};}},{projectId:"recovery-project",capabilityId:capB.id});
if(!handoffResult.result.ok||!handoffResult.result.verified)throw new Error("Recovered handoff did not execute and verify.");
if(core2.handoffs.get(handoff.id).status!=="completed")throw new Error("Recovered handoff was not completed.");
if(!core2.memory.recall("Execute the recovered workflow").some(e=>e.kind==="handoff"))throw new Error("Recovered handoff was not remembered.");

const final=await persistence.get(mission.id);
if(!final||final.mission.status!=="completed"||final.executionState.status!=="completed")throw new Error("Final recovered mission state was not persisted.");
if(!final.idempotency?.some(r=>r.key==="recovery-cycle:retry:1"&&r.status==="completed"))throw new Error("Recovered retry idempotency was not persisted.");
if(!final.handoffs?.some(h=>h.id===handoff.id&&h.status==="completed"))throw new Error("Completed handoff was not persisted.");

await rm(dir,{recursive:true,force:true});
console.log("Failure -> replan -> persistence -> recovery -> handoff -> verification cycle passed.");
