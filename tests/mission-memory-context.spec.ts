import {LayanXCore} from "../src/core/orchestrator.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

let plannerInput="";
let plannerCalls=0;
const provider:ModelProviderAdapter={
 name:"memory-test",
 async health(){return{provider:"memory-test",available:true,updatedAt:new Date().toISOString()};},
 async generate(model,request){
  plannerInput=request.input;
  plannerCalls++;
  return{provider:"memory-test",modelId:model.id,output:plannerCalls===1?JSON.stringify({tool:"step.two",action:"read second",permission:"L1_READ",reason:"memory-aware"}):"null"};
 }
};
const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"memory test",allowedTools:["step.one","step.two"],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
core.models.register({id:"planner",provider:"memory-test",capabilities:["reasoning"],local:true,enabled:true,priority:1});
core.providers.register(provider);
core.tools.register({name:"step.one",description:"first read",permission:"L1_READ",dangerous:false,actions:["read first"],tags:["read"]});
core.tools.register({name:"step.two",description:"second read",permission:"L1_READ",dangerous:false,actions:["read second"],tags:["read"]});
core.toolAdapters.register("step.one",{async execute(){const sensitiveField=["api","Key"].join(""); return{observation:"known-value",[sensitiveField]:"super-secret-value"};}});
core.toolAdapters.register("step.two",{async execute(){return{stage:2};}});

const mission=core.startMission("Use previous mission experience to continue","project");
mission.requiredPermission="L1_READ";
mission.steps=[{id:crypto.randomUUID(),description:"Execute reads",status:"pending"},{id:crypto.randomUUID(),description:"Verify result",status:"pending"}];
mission.tools=[{tool:"step.one",action:"read first",permission:"L1_READ",reason:"initial"}];
core.missions.save(mission);

const result=await core.executeMissionAdaptive(mission.id,"project-memory",5);
if(!result.completed)throw new Error("Memory-aware adaptive mission did not complete.");
const memories=core.memory.list().filter(entry=>entry.missionId===mission.id);
if(memories.length<2)throw new Error("Tool experiences were not persisted to mission memory.");
if(memories.some(entry=>JSON.stringify(entry.content).includes("super-secret-value")))throw new Error("Sensitive memory data was not sanitized.");
if(!plannerInput.includes("Mission memory context"))throw new Error("Adaptive planner did not receive mission memory context.");
if(!plannerInput.includes("known-value"))throw new Error("Adaptive planner did not receive the bounded mission experience.");
console.log("Mission memory context loop passed.");
