import {LayanXCore} from "../src/core/orchestrator.js";
import type {ToolRequest} from "../src/core/types.js";

const core=new LayanXCore();
core.registerAgent({
  agentId:"runner",purpose:"execute mission steps",allowedTools:["terminal.run"],forbiddenResources:[],
  requiredPermission:"L4_EXECUTE",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"
});
core.tools.register({name:"terminal.run",description:"Run command",permission:"L4_EXECUTE",dangerous:false});

const mission=core.startMission("Run command","default");
const capability=core.capabilities.issue({
  missionId:mission.id,agentId:"runner",projectId:"default",resource:"terminal.run",
  permission:"L4_EXECUTE",expiresAt:new Date(Date.now()+60000).toISOString()
});
const request:ToolRequest={
  missionId:mission.id,agentId:"runner",tool:"terminal.run",action:"run command",
  permission:"L4_EXECUTE",idempotencyKey:"integration-1",payload:{command:"echo ok"}
};
const adapter={async execute(){return{done:true};}};
const runner=new (await import("../src/core/mission-runner.js")).MissionRunner(core);
const blocked=await runner.execute(mission,request,adapter,undefined,{projectId:"wrong-project",capabilityId:capability.id});
if(blocked.ok||!String(blocked.error).includes("Project isolation"))throw new Error("Capability scope was not enforced.");

const successful=await runner.execute(mission,request,adapter,undefined,{projectId:"default",capabilityId:capability.id});
if(!successful.ok||!successful.verified||mission.status!=="completed")throw new Error("Secured mission execution failed.");
console.log("Mission runner and capability integration test passed.");
