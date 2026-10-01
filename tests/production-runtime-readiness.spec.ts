import {LayanXCore} from "../src/core/orchestrator.js";
import {CoreRuntime} from "../src/core/core-runtime.js";

const core=new LayanXCore();
core.models.register({id:"health-model",provider:"health-provider",capabilities:["reasoning"],local:true,enabled:true,priority:1});
core.providers.register({name:"health-provider",async health(){return{provider:"health-provider",available:true,updatedAt:new Date().toISOString()};},async generate(){return{modelId:"health-model",provider:"health-provider",output:"ok"};}});
core.registerAgent({agentId:"production-agent",purpose:"production execution",allowedTools:["echo"],forbiddenResources:["secrets"],requiredPermission:"L4_EXECUTE",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["echo"],stopCondition:"stop"});
core.tools.register({name:"echo",description:"echo",permission:"L4_EXECUTE",dangerous:true});

const runtime=CoreRuntime.withJsonStorage(":memory:");
const health=await runtime.health();
if(health.find(item=>item.name==="providers")?.status!=="healthy")throw new Error("Healthy provider was not reflected in system health.");
if(health.find(item=>item.name==="agents")?.status!=="healthy")throw new Error("Registered agent was not reflected in system health.");

const capability=core.capabilities.issue({missionId:"pending",agentId:"production-agent",projectId:"production-project",resource:"echo",permission:"L4_EXECUTE",expiresAt:new Date(Date.now()+60000).toISOString()});
try{
 await runtime.run("production secure execution",{agentId:"production-agent",tool:"echo",action:"echo",permission:"L4_EXECUTE",idempotencyKey:crypto.randomUUID(),payload:"ok"},{execute:async request=>request.payload},capability.id,"production-project");
 throw new Error("A capability scoped to another mission was accepted.");
}catch(error){
 if(!(error instanceof Error)||!error.message.includes("Capability"))throw error;
}

runtime.shutdown();
console.log("Production runtime readiness and scoped security test passed.");
