import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"test",allowedTools:["step.one","step.two"],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
for(const [name,action] of [["step.one","read first"],["step.two","read second"]] as const){
 core.tools.register({name,description:"test read step",permission:"L1_READ",dangerous:false,actions:[action],tags:["test","read"]});
 core.toolAdapters.register(name,{async execute(request){return{step:name,action:request.action};}});
}
const mission=core.startMission("Execute two read steps","project");
mission.requiredPermission="L1_READ";
mission.tools=[
 {tool:"step.one",action:"read first",permission:"L1_READ",reason:"first"},
 {tool:"step.two",action:"read second",permission:"L1_READ",reason:"second"}
];
const first=await core.executeMissionTool(mission.id,"project",0,{});
if(!first.ok||first.verified)throw new Error("first step should succeed without final verification");
if(first.recoverable!==true)throw new Error("first step should leave mission recoverable");
const mid=core.missions.get(mission.id);
if(mid?.status!=="running")throw new Error("mission should remain running after first step");
const all=await core.executeMissionTools(mission.id,"project");
if(!all.completed||all.results.length!==2)throw new Error("batch execution should safely replay the first step and execute the remaining step");
const stored=core.missions.get(mission.id);
if(stored?.status!=="completed")throw new Error("mission should complete after final step");
console.log("Multi-step mission execution passed.");
