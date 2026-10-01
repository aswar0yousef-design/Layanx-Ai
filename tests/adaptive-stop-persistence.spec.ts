import {LayanXCore} from "../src/core/orchestrator.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
import type {StorageAdapter,Transaction} from "../src/storage/repository.js";

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

function setup(persistence:RuntimePersistence,tool:string,execute:()=>Promise<unknown>){
  const core=new LayanXCore(undefined,persistence);
  core.registerAgent({
    agentId:"core",purpose:"adaptive persistence test",allowedTools:[tool],
    forbiddenResources:[],requiredPermission:"L1_READ",maxToolCalls:10,
    maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"
  });
  core.tools.register({
    name:tool,description:"test read",permission:"L1_READ",
    dangerous:false,actions:["read test"],tags:["test"]
  });
  core.toolAdapters.register(tool,{execute});
  return core;
}

const persistence=new RuntimePersistence(new RuntimeStorage(new MemoryStorage()));

const limited=setup(persistence,"step.limit",async()=>({ok:true}));
const limitedMission=limited.startMission("persist adaptive step limit");
limitedMission.requiredPermission="L1_READ";
limitedMission.tools=[{tool:"step.limit",action:"read test",permission:"L1_READ",reason:"test"}];
limited.missions.save(limitedMission);

const limitedResult=await limited.executeMissionAdaptive(limitedMission.id,"project",1);
if(limitedResult.completed||limitedResult.reason!=="Adaptive execution step limit reached.")
  throw new Error("Expected adaptive step-limit stop.");

const limitedSnapshot=await persistence.get(limitedMission.id);
if(!limitedSnapshot)throw new Error("Step-limit snapshot was not persisted.");
if(!limitedSnapshot.audit.some(event=>event.action==="mission.adaptive.stop"&&event.metadata?.reason==="step_limit"))
  throw new Error("Persisted step-limit adaptive audit decision is missing.");
if(!limitedSnapshot.memory?.some(entry=>entry.kind==="decision"&&entry.content&&typeof entry.content==="object"&&(entry.content as Record<string,unknown>).reason==="step_limit"))
  throw new Error("Persisted step-limit adaptive memory decision is missing.");

const failed=setup(persistence,"step.fail",async()=>{throw new Error("controlled failure");});
const failedMission=failed.startMission("persist adaptive tool failure");
failedMission.requiredPermission="L1_READ";
failedMission.tools=[{tool:"step.fail",action:"read test",permission:"L1_READ",reason:"test"}];
failed.missions.save(failedMission);

const failedResult=await failed.executeMissionAdaptive(failedMission.id,"project",3);
if(failedResult.completed||failedResult.reason!=="controlled failure")
  throw new Error("Expected adaptive tool-failure stop.");

const failedSnapshot=await persistence.get(failedMission.id);
if(!failedSnapshot)throw new Error("Tool-failure snapshot was not persisted.");
if(!failedSnapshot.audit.some(event=>event.action==="mission.adaptive.stop"&&event.metadata?.reason==="tool_failure"))
  throw new Error("Persisted tool-failure adaptive audit decision is missing.");
if(!failedSnapshot.memory?.some(entry=>entry.kind==="decision"&&entry.content&&typeof entry.content==="object"&&(entry.content as Record<string,unknown>).reason==="tool_failure"))
  throw new Error("Persisted tool-failure adaptive memory decision is missing.");

console.log("Persisted adaptive stop decisions passed.");
