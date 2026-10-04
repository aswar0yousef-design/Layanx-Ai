import {ModelRegistry} from "../src/models/registry.js";
import {ModelProviderRegistry,ModelExecutionRouter} from "../src/core/model-execution.js";
import type {ModelProviderAdapter} from "../src/models/inference.js";

const calls:string[]=[];
const primary:ModelProviderAdapter={
 name:"ollama",
 async health(){return{provider:"ollama",available:true,updatedAt:new Date().toISOString()};},
 async generate(){calls.push("ollama");throw new Error("local model unavailable");}
};
const backup:ModelProviderAdapter={
 name:"openai",
 async health(){return{provider:"openai",available:true,updatedAt:new Date().toISOString()};},
 async generate(model){calls.push("openai");return{modelId:model.id,provider:"openai",output:"executed"};}
};

const models=new ModelRegistry();
models.register({id:"local-model",provider:"ollama",capabilities:["chat"],local:true,enabled:true,priority:1});
models.register({id:"cloud-model",provider:"openai",capabilities:["chat"],local:false,enabled:true,priority:2});
const providers=new ModelProviderRegistry();
providers.register(primary);
providers.register(backup);

const result=await new ModelExecutionRouter(models,providers).execute({capability:"chat",input:"hello"});
if(result.output!=="executed")throw new Error("Execution did not return backup provider output.");
if(calls.join(",")!=="ollama,openai")throw new Error("Provider failover order was incorrect.");
if(result.attempts.length!==2||result.attempts[0].ok||!result.attempts[1].ok)throw new Error("Execution attempts were not recorded correctly.");
const missingModels=new ModelRegistry();
missingModels.register({id:"missing-model",provider:"missing",capabilities:["chat"],local:true,enabled:true,priority:1});
missingModels.register({id:"backup-model",provider:"openai",capabilities:["chat"],local:false,enabled:true,priority:2});
const missingResult=await new ModelExecutionRouter(missingModels,providers).execute({capability:"chat",input:"hello"});
if(missingResult.provider!=="openai")throw new Error("Missing provider did not fail over.");
console.log("Model execution E2E failover test passed.");
