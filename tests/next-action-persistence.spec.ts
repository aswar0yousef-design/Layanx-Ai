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

const core=new LayanXCore();
const mission=core.startMission("test continuation");
const agent={agentId:"agent-a",name:"A",allowedTools:["tool-a"],forbiddenResources:[],requiredPermission:"L1_READ" as const,maxToolCalls:5,successCriteria:[]};
core.registerAgent(agent);
const task=core.delegation.create(mission.id,agent,"continue task");
core.delegation.start(task.id);
const persistence=new RuntimePersistence(new RuntimeStorage(new MemoryStorage()));
const action=core.nextAction.decide({mission,tasks:core.delegation.forMission(mission.id),handoffs:[]});
await persistence.saveAtomic({mission,executionState:core.executionStates.get(mission.id)!,ledger:core.ledger.forMission(mission.id),audit:core.audit.forMission(mission.id),delegatedTasks:core.delegation.forMission(mission.id),nextAction:action,savedAt:new Date().toISOString(),schemaVersion:1});
const snap=await persistence.get(mission.id);
if(!snap?.delegatedTasks?.some(x=>x.id===task.id))throw new Error("Delegated task was not persisted.");
if(snap.nextAction?.kind!=="handoff")throw new Error("Next action was not persisted correctly.");
console.log("Next-action persistence test passed.");