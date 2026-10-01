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
      commit:async()=>undefined,rollback:async()=>undefined
    };
    return work(tx);
  }
}

const persistence=new RuntimePersistence(new RuntimeStorage(new MemoryStorage()));
const core=new LayanXCore(undefined,persistence);
core.registerAgent({agentId:"core",purpose:"adaptive continuation persistence",allowedTools:["test.tool"],forbiddenResources:[],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
core.tools.register({name:"test.tool",description:"test",permission:"L1_READ",dangerous:false,actions:["read"],tags:["test"]});
core.toolAdapters.register("test.tool",{execute:async()=>({ok:true})});
const mission=core.startMission("blocked adaptive continuation");
mission.requiredPermission="L1_READ";
mission.tools=[{tool:"test.tool",action:"read",permission:"L1_READ",reason:"test"}];
core.missions.save(mission);

const original=core.aiPlanner.nextTool.bind(core.aiPlanner);
core.aiPlanner.nextTool=async (...args:Parameters<typeof core.aiPlanner.nextTool>)=>{
  const next=await original(...args);
  mission.status="blocked";
  return next;
};

await core.executeMissionAdaptive(mission.id,"project",3);
const snapshot=await persistence.get(mission.id);
if(!snapshot)throw new Error("Blocked continuation snapshot was not persisted.");
if(!snapshot.audit.some(event=>event.action==="mission.adaptive.stop"&&event.metadata?.reason==="blocked"))
  throw new Error("Blocked adaptive stop audit decision is missing.");
if(!snapshot.memory?.some(entry=>entry.kind==="decision"&&entry.content&&typeof entry.content==="object"&&(entry.content as Record<string,unknown>).reason==="blocked"))
  throw new Error("Blocked adaptive stop memory decision is missing.");
console.log("Blocked adaptive continuation persistence passed.");
