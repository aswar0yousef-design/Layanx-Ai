import {LayanXCore} from "../src/core/orchestrator.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
import type {StorageAdapter,Transaction} from "../src/storage/repository.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

class MemoryAdapter implements StorageAdapter{
 private value:unknown;
 async transaction<T>(work:(tx:Transaction)=>Promise<T>):Promise<T>{
  return work({
   get:async<T>():Promise<T|undefined>=>structuredClone(this.value as T|undefined),
   set:async<T>(_key:string,value:T)=>{this.value=structuredClone(value);}
  } as Transaction);
 }
}
function setup(core:LayanXCore,outputs:string[],calls:{planner:number;tool:number}){
 core.registerAgent({agentId:"core",purpose:"recovery test",allowedTools:["step.one","step.two"],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
 const provider:ModelProviderAdapter={name:"test",async health(){return{provider:"test",available:true,updatedAt:new Date().toISOString()};},async generate(){return{provider:"test",modelId:"planner",output:outputs[calls.planner++]??"null"};}};
 core.models.register({id:"planner",provider:"test",capabilities:["reasoning"],local:true,enabled:true,priority:1});
 core.providers.register(provider);
 for(const [name,action] of [["step.one","read first"],["step.two","read second"]] as const){
  core.tools.register({name,description:name,permission:"L1_READ",dangerous:false,actions:[action],tags:["read"]});
  core.toolAdapters.register(name,{async execute(){calls.tool++;return{name,ok:true};}});
 }
}
const storage=new RuntimeStorage(new MemoryAdapter());
const persistence=new RuntimePersistence(storage);
const calls1={planner:0,tool:0};
const core1=new LayanXCore(undefined,persistence);
setup(core1,[JSON.stringify({tool:"step.two",action:"read second",permission:"L1_READ",reason:"continue"}),"null"],calls1);
const mission=core1.startMission("Recover a two-step mission","project");
mission.requiredPermission="L1_READ";
mission.steps=[{id:crypto.randomUUID(),description:"Execute reads",status:"pending"},{id:crypto.randomUUID(),description:"Verify result",status:"pending"}];
mission.tools=[{tool:"step.one",action:"read first",permission:"L1_READ",reason:"initial"}];
core1.missions.save(mission);
const first=await core1.executeMissionAdaptive(mission.id,"project",1);
if(first.completed||calls1.tool!==1)throw new Error("First bounded run should execute only the first step.");
const snapshot=await persistence.get(mission.id);
if(!snapshot)throw new Error("Adaptive snapshot was not persisted.");
const calls2={planner:0,tool:0};
const core2=new LayanXCore(undefined,persistence);
setup(core2,[JSON.stringify({tool:"step.two",action:"read second",permission:"L1_READ",reason:"continue"}),"null"],calls2);
core2.restoreRuntimeSnapshot(snapshot);
const resumed=await core2.executeMissionAdaptive(mission.id,"project",3);
if(!resumed.completed)throw new Error("Adaptive mission did not recover to completion.");
if(calls2.tool!==1)throw new Error("Recovery re-executed a completed first step.");
if(calls2.planner!==2)throw new Error("Recovery did not replan from the persisted result.");
console.log("Adaptive persistence and recovery passed.");
