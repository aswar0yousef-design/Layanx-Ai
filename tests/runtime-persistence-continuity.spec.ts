import {LayanXCore} from "../src/core/orchestrator.js";
import {ExecutionRuntime} from "../src/core/runtime.js";
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

const storage=new MemoryStorage();
const persistence=new RuntimePersistence(new RuntimeStorage(storage));
const core=new LayanXCore(undefined,persistence);
const agent={agentId:"agent-a",purpose:"continue",allowedTools:["tool-a"],forbiddenResources:[],requiredPermission:"L1_READ" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:[],stopCondition:"stop"};
core.registerAgent(agent);
const mission=core.startMission("runtime persistence continuity");
const task=core.delegation.create(mission.id,agent,"continue task");
core.delegation.start(task.id);
const runtime=new ExecutionRuntime(core,persistence);
await runtime.persist(mission);
const snap=await persistence.get(mission.id);
if(!snap?.delegatedTasks?.some(x=>x.id===task.id))throw new Error("ExecutionRuntime.persist did not save delegated tasks.");
if(snap.nextAction?.kind!=="handoff")throw new Error("ExecutionRuntime.persist did not save next action.");
console.log("ExecutionRuntime delegated-task and next-action persistence passed.");
