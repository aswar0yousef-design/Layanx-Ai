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
