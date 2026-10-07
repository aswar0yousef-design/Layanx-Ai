import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
// This test exercises execution itself; approval of dangerous tools is covered by dangerous-tool-approval.spec.ts.
process.env.LAYANX_AUTO_APPROVE_TOOLS="terminal.run";


const dir=await mkdtemp(join(tmpdir(),"layanx-e2e-"));
const persistence=new RuntimePersistence(RuntimeStorage.json(join(dir,"runtime.json")));
const core=new LayanXCore(undefined,persistence);

core.models.register({
  id:"e2e-planner",provider:"fake",capabilities:["reasoning"],local:true,enabled:true,priority:1
});
core.providers.register({
  name:"fake",
  async health(){return{provider:"fake",available:true,updatedAt:new Date().toISOString()};},
  async generate(model){return{
    modelId:model.id,provider:model.provider,
    output:JSON.stringify({
      risk:"low",
      requiredPermission:"L4_EXECUTE",
      steps:[
        {description:"Understand the requested operation"},
        {description:"Prepare the execution"},
        {description:"Execute the requested command"},
        {description:"Verify the result"}
      ],
      successCriteria:["done"],
      stopCondition:"Stop on security denial"
    })
  };}
});

const agent={
  agentId:"e2e-agent",purpose:"execute the planned command",
  allowedTools:["terminal.run"],forbiddenResources:[],
  requiredPermission:"L4_EXECUTE" as const,maxToolCalls:5,maxRuntimeMs:10000,
  successCriteria:["done"],stopCondition:"stop"
};
core.registerAgent(agent);
core.tools.register({name:"terminal.run",description:"Run the requested command",permission:"L4_EXECUTE",dangerous:true});

const mission=await core.planAndStartMission("Run the requested command safely.","e2e-project");
if(mission.status!=="planned"||mission.requiredPermission!=="L4_EXECUTE")throw new Error("Planned mission was not compiled correctly.");

const capability=core.capabilities.issue({
  missionId:mission.id,agentId:agent.agentId,projectId:"e2e-project",
  resource:"terminal.run",permission:"L4_EXECUTE",
  expiresAt:new Date(Date.now()+60000).toISOString()
});

const runner=new (await import("../src/core/mission-runner.js")).MissionRunner(core);
let calls=0;
const result=await runner.executeAction(
  mission,agent,"run requested command",{command:"echo layanx"},
  {async execute(){calls++;return{done:true,output:"layanx"};}},
  undefined,
  {projectId:"e2e-project",capabilityId:capability.id}
);

if(!result.result.ok||!result.result.verified)throw new Error("End-to-end execution did not verify.");
if(calls!==1)throw new Error("Tool adapter did not execute exactly once.");
if(mission.status!=="completed")throw new Error("Mission did not reach completed state.");
if(core.delegation.get(result.task.id).status!=="completed")throw new Error("Delegated task did not complete.");
if(!core.memory.recall("Run the requested command safely.").some(entry=>entry.missionId===mission.id))throw new Error("Verified result was not stored in memory.");

const persisted=await persistence.get(mission.id);
if(!persisted||persisted.mission.status!=="completed"||persisted.executionState.status!=="completed")throw new Error("Completed runtime state was not persisted.");
if(!persisted.audit.some(event=>event.result==="success"&&event.metadata?.missionId===mission.id))throw new Error("Success audit event was not persisted.");
if(!persisted.ledger.some(entry=>entry.status==="completed"))throw new Error("Completed ledger entry was not persisted.");
if(!persisted.memory?.some(entry=>entry.missionId===mission.id&&entry.kind==="success"))throw new Error("Verified mission memory was not persisted.");

await rm(dir,{recursive:true,force:true});
console.log("LayanX end-to-end goal-to-memory integration test passed.");
