import {LayanXCore} from "../src/core/orchestrator.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const plannerOutputs=[
 JSON.stringify({tool:"step.two",action:"read second",permission:"L1_READ",reason:"use first result"}),
 "null"
];
let plannerCalls=0;
const provider:ModelProviderAdapter={
 name:"test",
 async health(){return{provider:"test",available:true,updatedAt:new Date().toISOString()};},
 async generate(){return{provider:"test",modelId:"planner",output:plannerOutputs[plannerCalls++]??"null"};}
};

const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"adaptive test",allowedTools:["step.one","step.two"],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
core.models.register({id:"planner",provider:"test",capabilities:["reasoning"],local:true,enabled:true,priority:1});
core.providers.register(provider);
core.tools.register({name:"step.one",description:"first read",permission:"L1_READ",dangerous:false,actions:["read first"],tags:["read"]});
core.tools.register({name:"step.two",description:"second read",permission:"L1_READ",dangerous:false,actions:["read second"],tags:["read"]});
let firstCalls=0,secondCalls=0;
core.toolAdapters.register("step.one",{async execute(){firstCalls++;return{stage:1};}});
core.toolAdapters.register("step.two",{async execute(){secondCalls++;return{stage:2};}});

const mission=core.startMission("Use the first result to determine the second read","project");
mission.requiredPermission="L1_READ";
mission.steps=[
 {id:crypto.randomUUID(),description:"Execute the requested reads",status:"pending"},
 {id:crypto.randomUUID(),description:"Verify the result",status:"pending"}
];
mission.tools=[{tool:"step.one",action:"read first",permission:"L1_READ",reason:"initial"}];
core.missions.save(mission);

const result=await core.executeMissionAdaptive(mission.id,"project",5);
if(!result.completed)throw new Error("Adaptive mission did not complete.");
if(firstCalls!==1||secondCalls!==1)throw new Error("Adaptive execution did not execute each tool exactly once.");
if(plannerCalls!==2)throw new Error("Adaptive planner did not replan from the tool result and then stop.");
const stored=core.missions.get(mission.id);
if(stored?.status!=="completed")throw new Error("Adaptive mission was not finalized.");
if(stored.tools?.length!==2)throw new Error("Adaptive planner did not append the replanned tool.");
console.log("Result-aware adaptive mission execution passed.");
