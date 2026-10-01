import {ModelRegistry} from "../src/models/registry.js";
import {ModelExecutionRouter,ModelProviderRegistry} from "../src/core/model-execution.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const models=new ModelRegistry();
models.register({id:"primary-chat",provider:"primary",capabilities:["chat"],local:false,enabled:true,priority:1});
models.register({id:"fallback-chat",provider:"fallback",capabilities:["chat"],local:true,enabled:true,priority:2});

const providers=new ModelProviderRegistry();
const primary:ModelProviderAdapter={
 name:"primary",
 async health(){return{provider:"primary",available:false,reason:"simulated outage",updatedAt:new Date().toISOString()};},
 async generate(){throw new Error("must not execute unavailable provider");}
};
const fallback:ModelProviderAdapter={
 name:"fallback",
 async health(){return{provider:"fallback",available:true,updatedAt:new Date().toISOString()};},
 async generate(model,request){return{modelId:model.id,provider:this.name,output:"fallback:"+request.input};}
};
providers.register(primary);
providers.register(fallback);
const router=new ModelExecutionRouter(models,providers);
const result=await router.execute({capability:"chat",input:"hello"});
if(result.output!=="fallback:hello")throw new Error("Fallback model did not execute.");
if(result.attempts.length!==2||result.attempts[0]?.error!=="simulated outage"||result.attempts[1]?.ok!==true)throw new Error("Provider failover evidence is incomplete.");

const brokenModels=new ModelRegistry();
brokenModels.register({id:"broken",provider:"broken",capabilities:["chat"],local:false,enabled:true,priority:1});
const brokenProviders=new ModelProviderRegistry();
brokenProviders.register({name:"broken",async health(){return{provider:"broken",available:true,updatedAt:new Date().toISOString()};},async generate(){throw new Error("provider failure");}});
try{await new ModelExecutionRouter(brokenModels,brokenProviders).execute({capability:"chat",input:"x"});throw new Error("Expected all-provider failure.");}catch(error){if(!(error instanceof Error)||!error.message.includes("All candidate model providers failed"))throw error;}

console.log("Model execution failover test passed.");
