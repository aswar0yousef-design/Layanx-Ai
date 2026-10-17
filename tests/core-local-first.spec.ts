import assert from "node:assert/strict";
import {LayanXCore} from "../src/core/orchestrator.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const core=new LayanXCore();
const calls:string[]=[];
const local:ModelProviderAdapter={
  name:"local-test",
  async health(){return{provider:"local-test",available:true,updatedAt:new Date().toISOString()};},
  async generate(model,request){
    calls.push("local");
    if(request.input==="force fallback")throw new Error("simulated local model failure");
    return{provider:this.name,modelId:model.id,output:"local answer"};
  }
};
const cloud:ModelProviderAdapter={
  name:"cloud-test",
  async health(){return{provider:"cloud-test",available:true,updatedAt:new Date().toISOString()};},
  async generate(model){
    calls.push("cloud");
    return{provider:this.name,modelId:model.id,output:"cloud fallback"};
  }
};
core.providers.register(local);
core.providers.register(cloud);
core.models.register({id:"local-model",provider:"local-test",capabilities:["reasoning"],local:true,enabled:true,priority:999,qualityScore:5});
core.models.register({id:"cloud-model",provider:"cloud-test",capabilities:["reasoning"],local:false,enabled:true,priority:0,qualityScore:100});

const localResult=await core.modelExecution.execute({capability:"reasoning",input:"local succeeds"});
assert.equal(localResult.modelId,"local-model");
assert.equal(localResult.output,"local answer");
assert.deepEqual(calls,["local"],"cloud must not run when the local model succeeds");

calls.length=0;
const fallbackResult=await core.modelExecution.execute({capability:"reasoning",input:"force fallback"});
assert.equal(fallbackResult.modelId,"cloud-model");
assert.equal(fallbackResult.output,"cloud fallback");
assert.deepEqual(calls,["local","cloud"],"cloud is attempted only after the local model fails");
assert.deepEqual(fallbackResult.attempts.map(attempt=>attempt.ok),[false,true]);

console.log("core-local-first: local-first routing and fallback to cloud verified");

const healthFallbackCore=new LayanXCore();
const healthCalls:string[]=[];
const unhealthyLocal:ModelProviderAdapter={
  name:"unhealthy-local",
  async health(){healthCalls.push("health-unhealthy");throw new Error("simulated health endpoint crash");},
  async generate(model){healthCalls.push("generate-unhealthy");return{provider:this.name,modelId:model.id,output:"must not run"};}
};
const backupLocal:ModelProviderAdapter={
  name:"backup-local",
  async health(){healthCalls.push("health-backup");return{provider:this.name,available:true,updatedAt:new Date().toISOString()};},
  async generate(model){healthCalls.push("generate-backup");return{provider:this.name,modelId:model.id,output:"backup local answer"};}
};
healthFallbackCore.providers.register(unhealthyLocal);
healthFallbackCore.providers.register(backupLocal);
healthFallbackCore.models.register({id:"unhealthy-local-model",provider:"unhealthy-local",capabilities:["reasoning"],local:true,enabled:true,priority:0});
healthFallbackCore.models.register({id:"backup-local-model",provider:"backup-local",capabilities:["reasoning"],local:true,enabled:true,priority:1});
const healthResult=await healthFallbackCore.modelExecution.execute({capability:"reasoning",input:"recover from a provider health exception"});
assert.equal(healthResult.modelId,"backup-local-model");
assert.deepEqual(healthCalls,["health-unhealthy","health-backup","generate-backup"]);
assert.equal(healthResult.attempts[0]?.ok,false);
assert.match(healthResult.attempts[0]?.error??"",/health check failed/i);


const fallbackCore=new LayanXCore();
const plannerCalls:string[]=[];
fallbackCore.registerAgent({
  agentId:"core",purpose:"Only read runtime status",allowedTools:["runtime.status"],forbiddenResources:[],
  requiredPermission:"L1_READ",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"
});
fallbackCore.tools.register({
  name:"runtime.status",description:"read runtime status",permission:"L1_READ",dangerous:false,
  actions:["read runtime status"],tags:["runtime","status"]
});
const brokenLocalPlanner:ModelProviderAdapter={
  name:"broken-local-planner",
  async health(){return{provider:this.name,available:true,updatedAt:new Date().toISOString()};},
  async generate(model){plannerCalls.push("local");return{provider:this.name,modelId:model.id,output:"not valid planner JSON"};}
};
const cloudPlanner:ModelProviderAdapter={
  name:"cloud-planner-fallback",
  async health(){return{provider:this.name,available:true,updatedAt:new Date().toISOString()};},
  async generate(model){
    plannerCalls.push("cloud");
    return{provider:this.name,modelId:model.id,output:JSON.stringify({
      risk:"low",requiredPermission:"L1_READ",
      steps:[{description:"Execute: read runtime status"}],
      successCriteria:["done"],stopCondition:"Stop after reading status.",
      tools:[{tool:"runtime.status",action:"read runtime status",permission:"L1_READ",reason:"Read status."}]
    })};
  }
};
fallbackCore.providers.register(brokenLocalPlanner);
fallbackCore.providers.register(cloudPlanner);
fallbackCore.models.register({id:"broken-local-model",provider:"broken-local-planner",capabilities:["reasoning"],local:true,enabled:true,priority:999});
fallbackCore.models.register({id:"cloud-fallback-model",provider:"cloud-planner-fallback",capabilities:["reasoning"],local:false,enabled:true,priority:0});
(fallbackCore as any).executeAgentLoop=async(missionId:string)=>{
  const mission=fallbackCore.missions.get(missionId);
  assert.equal(mission?.tools?.[0]?.tool,"runtime.status");
  return{missionId,completed:true,status:"completed",steps:0,results:[]};
};
const gatewayResult=await fallbackCore.runAgentGateway("Read runtime status","default",5,{},"core",{preferLocal:true,tags:["runtime"]}) as any;
assert.equal(gatewayResult.completed,true);
assert.deepEqual(plannerCalls,["local","cloud"],"a local planning failure must fall back to cloud even when a task router supplied local-first tags");
assert.equal(gatewayResult.modelRouting?.reason,"fallback");

