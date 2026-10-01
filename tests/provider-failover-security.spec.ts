import {ModelRegistry} from "../src/models/registry.js";
import {ModelExecutionRouter,ModelProviderRegistry} from "../src/core/model-execution.js";
import {OpenAICompatibleProvider} from "../src/models/http-providers.js";

const models=new ModelRegistry();
models.register({id:"primary",provider:"primary",capabilities:["chat"],local:false,enabled:true,priority:1});
models.register({id:"fallback",provider:"fallback",capabilities:["chat"],local:true,enabled:true,priority:2});
const providers=new ModelProviderRegistry();
providers.register({name:"primary",async health(){return{provider:"primary",available:false,reason:"outage",updatedAt:new Date().toISOString()};},async generate(){throw new Error("must not execute");}});
providers.register({name:"fallback",async health(){return{provider:"fallback",available:true,updatedAt:new Date().toISOString()};},async generate(model,request){return{modelId:model.id,provider:"fallback",output:"ok:"+request.input};}});
const result=await new ModelExecutionRouter(models,providers).execute({capability:"chat",input:"hello"});
if(result.provider!=="fallback"||result.output!=="ok:hello")throw new Error("Provider failover failed.");

const secret="SUPER_SECRET_TEST_TOKEN_123";
const calls:Array<{url:string;init?:RequestInit}>=[];
const fakeFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(input),init});return new Response(JSON.stringify({choices:[{message:{content:"safe"}}]}),{status:200});};
const provider=new OpenAICompatibleProvider({name:"cloud",baseUrl:"https://provider.test/v1",apiKey:async()=>secret,fetcher:fakeFetch});
const response=await provider.generate({id:"cloud-model",provider:"cloud",capabilities:["chat"],local:false,enabled:true,priority:1},{capability:"chat",input:"test"});
if(response.output!=="safe")throw new Error("Cloud provider response failed.");
const auth=String(calls[0]?.init?.headers&&new Headers(calls[0].init.headers).get("authorization"));
if(auth!=="Bearer "+secret)throw new Error("Secret was not supplied through the provider boundary.");
let leaked=false;
try{
 const failing=new OpenAICompatibleProvider({name:"cloud",baseUrl:"https://provider.test/v1",apiKey:secret,fetcher:async()=>new Response(secret,{status:500})});
 await failing.generate({id:"cloud-model",provider:"cloud",capabilities:["chat"],local:false,enabled:true,priority:1},{capability:"chat",input:"test"});
}catch(error){leaked=error instanceof Error&&error.message.includes(secret);}
if(leaked)throw new Error("Provider error leaked a credential value.");
console.log("Provider failover and secret-boundary tests passed.");