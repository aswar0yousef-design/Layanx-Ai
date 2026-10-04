import {LayanXCore} from "../src/core/orchestrator.js";
import {registerBuiltinTools} from "../src/tools/builtin.js";
import type {AgentContract} from "../src/core/contracts.js";

const core=new LayanXCore();
registerBuiltinTools(core);
const agent:AgentContract={
  agentId:"core",purpose:"test safe built-ins",
  allowedTools:["runtime.status","mission.inspect","memory.recall"],
  forbiddenResources:["secrets","security-controls"],requiredPermission:"L1_READ",
  maxToolCalls:10,maxRuntimeMs:30000,
  successCriteria:["mission exists","mission has goal","mission has execution plan"],stopCondition:"stop"
};
core.registerAgent(agent);

const mission=core.startMission("read runtime status","test");
const capability=core.capabilities.issue({missionId:mission.id,agentId:"core",projectId:"test",resource:"runtime.status",permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()});
const selected=core.toolSelector.select("read runtime status",agent,mission.requiredPermission);
if(selected[0]?.tool.name!=="runtime.status")throw new Error("runtime.status was not selected");
const result=await core.executionRuntime.run(mission,{missionId:mission.id,agentId:"core",tool:"runtime.status",action:"read runtime status",permission:"L1_READ",idempotencyKey:"builtin-status-1",payload:{}},core.toolAdapters.get("runtime.status"),undefined,{projectId:"test",capabilityId:capability.id});
if(!result.ok||!result.verified)throw new Error("runtime.status execution failed: "+result.error);
const status=result.data as {ready:boolean;tools:Array<{name:string}>};
if(!status.ready||!status.tools.some(tool=>tool.name==="memory.recall"))throw new Error("runtime status payload incomplete");

const inspectMission=core.startMission("inspect mission","test");
const inspectCapability=core.capabilities.issue({missionId:inspectMission.id,agentId:"core",projectId:"test",resource:"mission.inspect",permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()});
const inspected=await core.executionRuntime.run(inspectMission,{missionId:inspectMission.id,agentId:"core",tool:"mission.inspect",action:"read mission status",permission:"L1_READ",idempotencyKey:"builtin-inspect-1",payload:{}},core.toolAdapters.get("mission.inspect"),undefined,{projectId:"test",capabilityId:inspectCapability.id});
if(!inspected.ok||!inspected.verified)throw new Error("mission.inspect execution failed: "+inspected.error);
if((inspected.data as {id:string}).id!==inspectMission.id)throw new Error("mission.inspect returned wrong mission");

core.memory.remember({missionId:inspectMission.id,kind:"fact",summary:"Oman shipping provider",content:{provider:"local"},confidence:1,tags:["shipping","provider"]});
const memoryMission=core.startMission("recall shipping memory","test");
const memoryCapability=core.capabilities.issue({missionId:memoryMission.id,agentId:"core",projectId:"test",resource:"memory.recall",permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()});
const recalled=await core.executionRuntime.run(memoryMission,{missionId:memoryMission.id,agentId:"core",tool:"memory.recall",action:"read shipping memory",permission:"L1_READ",idempotencyKey:"builtin-memory-1",payload:{query:"shipping provider",limit:5}},core.toolAdapters.get("memory.recall"),undefined,{projectId:"test",capabilityId:memoryCapability.id});
if(!recalled.ok||!recalled.verified)throw new Error("memory.recall execution failed: "+recalled.error);
if((recalled.data as {entries:unknown[]}).entries.length!==1)throw new Error("memory.recall did not return expected entry");
console.log("Built-in safe tool execution test passed.");