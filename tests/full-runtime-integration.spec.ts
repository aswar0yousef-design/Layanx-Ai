import {LayanXCore} from "../src/core/orchestrator.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
import {MissionRunner} from "../src/core/mission-runner.js";
import type {StorageAdapter,Transaction} from "../src/storage/repository.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

class MemoryStorage implements StorageAdapter{
  private state=new Map<string,unknown>();
  async transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>{
    const tx:Transaction={
      get:async<T>(key:string)=>structuredClone(this.state.get(key)) as T|undefined,
      set:async<T>(key:string,value:T)=>{this.state.set(key,structuredClone(value));},
      commit:async()=>undefined,
      rollback:async()=>undefined
    };
    return work(tx);
  }
}

const storage=new MemoryStorage();
const persistence=new RuntimePersistence(new RuntimeStorage(storage));
const core=new LayanXCore(undefined,persistence);

const plannerProvider:ModelProviderAdapter={
  name:"planner-test",
  async health(){return{provider:"planner-test",available:true,updatedAt:new Date().toISOString()};},
  async generate(model){
    return{
      modelId:model.id,
      provider:"planner-test",
      output:JSON.stringify({
        risk:"low",
        requiredPermission:"L1_READ",
        steps:[
          {description:"Understand and normalize goal"},
          {description:"Execute requested read action"},
          {description:"Verify result"}
        ],
        successCriteria:["result.value === \"fixture-ok\""],
        stopCondition:"Stop on policy denial."
      })
    };
  }
};

core.models.register({
  id:"planner-test-model",
  provider:"planner-test",
  capabilities:["reasoning"],
  local:true,
  enabled:true,
  priority:1
});
core.providers.register(plannerProvider);

const agent={
  agentId:"integration-agent",
  purpose:"Execute safe integration work.",
  allowedTools:["data.read"],
  forbiddenResources:[],
  requiredPermission:"L1_READ" as const,
  maxToolCalls:5,
  maxRuntimeMs:10000,
  successCriteria:["result.value === \"fixture-ok\""],
  stopCondition:"Stop on policy denial."
};
core.registerAgent(agent);
core.tools.register({
  name:"data.read",
  description:"Read requested data safely.",
  permission:"L1_READ",
  dangerous:false
});

const mission=await core.planAndStartMission("Read the integration fixture","integration-project");
if(mission.status!=="planned"||mission.requiredPermission!=="L1_READ")throw new Error("AI planner did not produce a valid mission.");
if(mission.steps.length!==3)throw new Error("Compiled AI mission steps are incorrect.");

const capability=core.capabilities.issue({
  missionId:mission.id,
  agentId:agent.agentId,
  projectId:"integration-project",
  resource:"data.read",
  permission:"L1_READ",
  expiresAt:new Date(Date.now()+60000).toISOString()
});

let executions=0;
const result=await new MissionRunner(core).executeAction(
  mission,
  agent,
  "read requested data",
  {fixture:"ok"},
  {async execute(){executions++;return{value:"fixture-ok"};}},
  undefined,
  {projectId:"integration-project",capabilityId:capability.id}
);

if(!result.result.ok||!result.result.verified)throw new Error("Mission execution was not verified.");
if(executions!==1)throw new Error("Tool adapter did not execute exactly once.");
if(mission.status!=="completed")throw new Error("Mission did not reach completed state.");
if(mission.steps.every(step=>step.status!=="completed"))throw new Error("Mission execution step was not completed.");

const snapshot=await persistence.get(mission.id);
if(!snapshot)throw new Error("Completed mission snapshot was not persisted.");
if(snapshot.mission.status!=="completed")throw new Error("Persisted mission is not completed.");
if(snapshot.executionState.status!=="completed")throw new Error("Persisted execution state is not completed.");
if(!snapshot.idempotency?.some(record=>record.status==="completed"))throw new Error("Completed execution was not persisted in idempotency state.");
if(!snapshot.memory?.some(entry=>entry.kind==="success"))throw new Error("Successful mission memory was not persisted.");
if(snapshot.nextAction?.kind!=="complete")throw new Error("Persisted next action is not complete.");

console.log("Full runtime integration: AI planner -> mission -> execution -> verification -> persistence passed.");
