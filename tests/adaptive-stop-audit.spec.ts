import {LayanXCore} from "../src/core/orchestrator.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

function setup(tool:string,execute:(request:unknown)=>Promise<unknown>){
  const core=new LayanXCore();
  core.registerAgent({agentId:"core",purpose:"adaptive stop test",allowedTools:[tool],forbiddenResources:[],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
  core.tools.register({name:tool,description:"test read",permission:"L1_READ",dangerous:false,actions:["read test"],tags:["test"]});
  core.toolAdapters.register(tool,{execute});
  return core;
}

const limited=setup("step.limit",async()=>({ok:true}));
const limitedMission=limited.startMission("test step limit","project");
limitedMission.requiredPermission="L1_READ";
limitedMission.tools=[{tool:"step.limit",action:"read test",permission:"L1_READ",reason:"test"}];
limited.missions.save(limitedMission);
const limitedResult=await limited.executeMissionAdaptive(limitedMission.id,"project",1);
if(limitedResult.completed||!limitedResult.reason?.includes("step limit"))throw new Error("Expected adaptive step limit.");
const limitedAudit=limited.audit.forMission(limitedMission.id).find(event=>event.action==="mission.adaptive.stop");
if(limitedAudit?.metadata?.reason!=="step_limit")throw new Error("Step limit audit reason missing.");
if(!limited.memory.list().some(entry=>entry.kind==="decision"&&entry.content&&typeof entry.content==="object"&&(entry.content as Record<string,unknown>).reason==="step_limit"))throw new Error("Step limit memory decision missing.");

const failed=setup("step.fail",async()=>{throw new Error("controlled tool failure");});
const failedMission=failed.startMission("test tool failure","project");
failedMission.requiredPermission="L1_READ";
failedMission.tools=[{tool:"step.fail",action:"read test",permission:"L1_READ",reason:"test"}];
failed.missions.save(failedMission);
const failedResult=await failed.executeMissionAdaptive(failedMission.id,"project",3);
if(failedResult.completed||failedResult.reason!=="controlled tool failure")throw new Error("Expected adaptive tool failure.");
const failedAudit=failed.audit.forMission(failedMission.id).find(event=>event.action==="mission.adaptive.stop");
if(failedAudit?.metadata?.reason!=="tool_failure")throw new Error("Tool failure audit reason missing.");

const planner:ModelProviderAdapter={
  name:"stop-planner",
  async health(){return{provider:"stop-planner",available:true,updatedAt:new Date().toISOString()};},
  async generate(){return{provider:"stop-planner",modelId:"planner",output:"null"};}
};
const complete=setup("unused",async()=>({ok:true}));
complete.models.register({id:"planner",provider:"stop-planner",capabilities:["reasoning"],local:true,enabled:true,priority:1});
complete.providers.register(planner);
const completeMission=complete.startMission("test planner completion","project");
completeMission.requiredPermission="L1_READ";
complete.missions.save(completeMission);
const completeResult=await complete.executeMissionAdaptive(completeMission.id,"project",3);
if(completeResult.completed||!completeResult.reason?.includes("no executable tool"))throw new Error("Expected planner completion stop.");
const completeAudit=complete.audit.forMission(completeMission.id).find(event=>event.action==="mission.adaptive.stop");
if(completeAudit?.metadata?.reason!=="planner_complete")throw new Error("Planner completion audit reason missing.");

console.log("Adaptive stop audit and memory passed.");

const plannerFailure=setup("planner.fail",async()=>({ok:true}));
plannerFailure.models.register({id:"failing-planner",provider:"failing-planner",capabilities:["reasoning"],local:true,enabled:true,priority:1});
plannerFailure.providers.register({
  name:"failing-planner",
  async health(){return{provider:"failing-planner",available:true,updatedAt:new Date().toISOString()};},
  async generate(){throw new Error("planner unavailable");}
});
const plannerFailureMission=plannerFailure.startMission("test planner failure");
plannerFailureMission.requiredPermission="L1_READ";
plannerFailureMission.tools=[{tool:"planner.fail",action:"read test",permission:"L1_READ",reason:"seed"}];
plannerFailure.missions.save(plannerFailureMission);
const plannerFailureResult=await plannerFailure.executeMissionAdaptive(plannerFailureMission.id,"project",3);
if(plannerFailureResult.completed||!plannerFailureResult.reason?.includes("Adaptive planner execution failed"))throw new Error("Expected planner failure stop.");
const plannerFailureAudit=plannerFailure.audit.forMission(plannerFailureMission.id).find(event=>event.action==="mission.adaptive.stop");
if(plannerFailureAudit?.metadata?.reason!=="planner_failure")throw new Error("Planner failure audit reason missing.");
