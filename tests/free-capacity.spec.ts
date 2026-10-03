import {ModelRegistry,type ModelDefinition} from "../src/models/registry.js";
import {FreeCapacityProvider} from "../src/providers/free-capacity.js";
import {ModelExecutionRouter,ModelProviderRegistry} from "../src/core/model-execution.js";

const freeModel:ModelDefinition={id:"free:demo:remote-model",provider:"demo-free",providerModelId:"remote-model",capabilities:["chat"],local:false,enabled:true,priority:20,costPer1kInputUsd:0,costPer1kOutputUsd:0,tags:["free"]};
const paidModel:ModelDefinition={id:"paid",provider:"paid",capabilities:["chat"],local:false,enabled:true,priority:10};

const calls:Array<{url:string;init?:RequestInit}>=[];
const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);calls.push({url,init});
  if(url.endsWith("/chat/completions"))return new Response(JSON.stringify({choices:[{message:{content:"ok"}}],usage:{prompt_tokens:3,completion_tokens:4}}),{status:200});
  return new Response("ok",{status:200});
};

const free=new FreeCapacityProvider({name:"demo-free",baseUrl:"https://free.test/v1",models:["remote-model"],dailyTokenLimit:100,tags:["free"]},fetcher);
const providers=new ModelProviderRegistry();providers.register(free);
const models=new ModelRegistry();models.register(freeModel);
const result=await new ModelExecutionRouter(models,providers).execute({capability:"chat",input:"hello"});
if(result.output!=="ok"||result.modelId!==freeModel.id||result.usage?.costUsd!==0)throw new Error("Free provider execution failed.");
const chatCall=calls.find(call=>call.url.endsWith("/chat/completions"));
if(!chatCall)throw new Error("Free provider request was not sent.");
const requestBody=JSON.parse(String(chatCall.init?.body));
if(requestBody.model!=="remote-model")throw new Error("Provider model id was not preserved.");
const status=free.status();
if(status.dailyUsedTokens!==7||status.monthlyUsedTokens!==7)throw new Error("Free token accounting failed.");

const exhausted=new FreeCapacityProvider({name:"limited",baseUrl:"https://limited.test/v1",models:["m"],dailyTokenLimit:1},fetcher);
const health=await exhausted.health();
if(!health.available)throw new Error("Fresh free quota should be available.");

const routing=new ModelRegistry();routing.register(paidModel);routing.register(freeModel);
const routeProviders=new ModelProviderRegistry();
routeProviders.register({name:"paid",async health(){return{provider:"paid",available:true,updatedAt:new Date().toISOString()};},async generate(model){return{modelId:model.id,provider:"paid",output:"paid"};}});
routeProviders.register(free);
const preferred=await new ModelExecutionRouter(routing,routeProviders,{preferFree:true}).execute({capability:"chat",input:"hello"});
if(preferred.provider!=="demo-free")throw new Error("preferFree did not select the free provider.");

console.log("Free capacity pool test passed.");
