import {LayanXCore} from "../src/core/orchestrator.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
import {MissionRunner} from "../src/core/mission-runner.js";
import type {StorageAdapter,Transaction} from "../src/storage/repository.js";

class MemoryStorage implements StorageAdapter{
 private state=new Map<string,unknown>();
 async transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>{
  const tx:Transaction={get:async<T>(k:string)=>structuredClone(this.state.get(k)) as T|undefined,set:async<T>(k:string,v:T)=>{this.state.set(k,structuredClone(v));},commit:async()=>undefined,rollback:async()=>undefined};
  return work(tx);
 }
}
const persistence=new RuntimePersistence(new RuntimeStorage(new MemoryStorage()));
const core=new LayanXCore(undefined,persistence);
const a={agentId:"a",purpose:"prepare",allowedTools:["terminal.run"],forbiddenResources:[],requiredPermission:"L4_EXECUTE" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
const b={agentId:"b",purpose:"handoff",allowedTools:["terminal.run"],forbiddenResources:[],requiredPermission:"L4_EXECUTE" as const,maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"};
core.registerAgent(a);core.registerAgent(b);core.tools.register({name:"terminal.run",description:"run",permission:"L4_EXECUTE",dangerous:true});
const mission=core.startMission("final handoff state");mission.requiredPermission="L4_EXECUTE";mission.steps=[{id:"execute",description:"Execute handoff",status:"pending"},{id:"verify",description:"Verify result",status:"pending"}];
const secret="SUPER_SECRET_TEST_TOKEN_123";
const h=core.handoffs.create({missionId:mission.id,fromAgentId:a.agentId,toAgent:b,goal:"finish",context:{apiKey:secret,normal:"ok"},requiredPermission:"L4_EXECUTE",execution:{action:"run",tool:"terminal.run",payload:{authorization:"Bearer abcdefghijk"}}});
if(JSON.stringify(h).includes(secret)||JSON.stringify(h).includes("Bearer abcdefghijk"))throw new Error("Handoff secret leaked.");
core.handoffs.accept(h.id);
const cap=core.capabilities.issue({missionId:mission.id,agentId:b.agentId,projectId:"p",resource:"terminal.run",permission:"L4_EXECUTE",expiresAt:new Date(Date.now()+60000).toISOString()});
const result=await new MissionRunner(core).executeHandoff(mission,h,{async execute(){return{done:true};}},{projectId:"p",capabilityId:cap.id});
if(!result.result.ok||core.handoffs.get(h.id).status!=="completed")throw new Error("Handoff did not complete.");
const snap=await persistence.get(mission.id);
if(!snap||snap.mission.status!=="completed"||snap.executionState.status!=="completed")throw new Error("Final completed state was not persisted.");
if(snap.nextAction?.kind!=="complete")throw new Error("Final next action is not complete.");
const serialized=JSON.stringify(snap);
if(serialized.includes(secret)||serialized.includes("Bearer abcdefghijk"))throw new Error("Secret leaked into final snapshot.");
if(!snap.memory?.some(m=>m.kind==="success"&&m.missionId===mission.id)||!snap.memory.some(m=>m.kind==="handoff"))throw new Error("Final memory is incomplete.");
console.log("Final handoff -> verification -> memory -> persistence cycle passed.");