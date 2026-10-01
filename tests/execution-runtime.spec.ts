import {LayanXCore} from "../src/core/orchestrator.js";
import type {ToolRequest} from "../src/core/types.js";

const core=new LayanXCore();
core.registerAgent({
  agentId:"executor",purpose:"execute approved work",allowedTools:["terminal.run"],forbiddenResources:[],
  requiredPermission:"L4_EXECUTE",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"
});
core.tools.register({name:"terminal.run",description:"Run a safe command",permission:"L4_EXECUTE",dangerous:true});
const mission=core.startMission("Run a safe command");
const expiresAt=new Date(Date.now()+60000).toISOString();
const capability=core.capabilities.issue({missionId:mission.id,agentId:"executor",projectId:"project-1",resource:"terminal.run",permission:"L4_EXECUTE",expiresAt});
const request:ToolRequest={missionId:mission.id,agentId:"executor",tool:"terminal.run",action:"run command",permission:"L4_EXECUTE",idempotencyKey:"runtime-1",payload:{command:"echo ok"}};
let executions=0;
const adapter={async execute(){executions++;return{stdout:"ok"};}};
const first=await core.executionRuntime.run(mission,request,adapter,{projectId:"project-1",capabilityId:capability.id});
if(!first.ok||!first.verified||executions!==1)throw new Error("Execution runtime first pass failed.");
const replay=await core.executionRuntime.run(mission,request,adapter,{projectId:"project-1",capabilityId:capability.id});
if(!replay.ok||!replay.verified||executions!==1)throw new Error("Idempotent replay executed the tool twice.");

const highMission=core.startMission("Delete test data");
const highCapability=core.capabilities.issue({missionId:highMission.id,agentId:"executor",projectId:"project-1",resource:"terminal.run",permission:"L4_EXECUTE",expiresAt});
const highRequest={...request,missionId:highMission.id,idempotencyKey:"runtime-2",action:"delete test data"};
const blocked=await core.executionRuntime.run(highMission,highRequest,adapter,{projectId:"project-1",capabilityId:highCapability.id});
if(blocked.ok||!String(blocked.error).includes("approval"))throw new Error("High-risk action bypassed scoped approval.");

console.log("Execution runtime security and idempotency test passed.");
