import {LayanXCore} from "../src/core/orchestrator.js";
import {ExecutionRuntime} from "../src/core/runtime.js";

const makeCore=()=>{
 const core=new LayanXCore();
 core.registerAgent({agentId:"test-agent",purpose:"test",allowedTools:["echo"],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["result === \"not-ok\""],stopCondition:"stop on denial"});
 core.tools.register({name:"echo",description:"test echo",permission:"L1_READ",dangerous:false});
 return core;
};

const core=makeCore();
const mission=core.startMission("Run an echo test","default");
const runtime=new ExecutionRuntime(core);
const result=await runtime.run(mission,{missionId:mission.id,agentId:"test-agent",tool:"echo",action:"echo",permission:"L1_READ",idempotencyKey:crypto.randomUUID(),payload:"hello"},{execute:async request=>request.payload},undefined,{projectId:"default",capabilityId:core.capabilities.issue({missionId:mission.id,agentId:"test-agent",projectId:"default",resource:"echo",permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()}).id});
if(!result.ok||!result.verified)throw new Error("Core runtime test failed.");
if(mission.status!=="completed")throw new Error("Successful mission did not complete.");

const failedCore=makeCore();
const failedMission=failedCore.startMission("Verification failure test","default");
failedMission.steps[3]!.status="pending";
const failedRuntime=new ExecutionRuntime(failedCore);
const failedResult=await failedRuntime.run(failedMission,{missionId:failedMission.id,agentId:"test-agent",tool:"echo",action:"echo",permission:"L1_READ",idempotencyKey:crypto.randomUUID(),payload:"hello"},{execute:async()=> "ok"},undefined,{projectId:"default",capabilityId:failedCore.capabilities.issue({missionId:failedMission.id,agentId:"test-agent",projectId:"default",resource:"echo",permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()}).id});
if(failedResult.ok||failedResult.verified)throw new Error("Invalid execution state should fail verification.");
if(failedMission.status!=="failed")throw new Error("Verification failure did not fail mission.");

console.log("Core verification tests passed.");
