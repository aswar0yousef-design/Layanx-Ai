import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"capability ordering test",allowedTools:["runtime.status"],forbiddenResources:[],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
core.tools.register({name:"runtime.status",description:"read runtime status",permission:"L1_READ",dangerous:false,actions:["read runtime status"],tags:["runtime"]});
core.toolAdapters.register("runtime.status",{async execute(){return{ok:true};}});
const mission=core.startMission("Reject invalid tool before capability issuance","project-test");
mission.requiredPermission="L1_READ";
mission.tools=[{tool:"unknown.tool",action:"read unknown",permission:"L1_READ",reason:"invalid"}];
const before=core.capabilities.active().length;
let rejected=false;
try{await core.executeMissionTool(mission.id,"project-test");}catch(error){rejected=error instanceof Error&&error.message.includes("outside the allowed catalog");}
if(!rejected)throw new Error("Invalid mission tool was not rejected.");
if(core.capabilities.active().length!==before)throw new Error("Invalid mission tool issued a capability before validation.");
console.log("Capability issuance ordering passed.");
