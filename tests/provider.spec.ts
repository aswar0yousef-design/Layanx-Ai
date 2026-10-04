import {ModelRegistry} from "../src/models/registry.js";
import {ModelRouter} from "../src/core/model-router.js";
import {ProviderRouter} from "../src/core/provider-router.js";
import type {ModelClient} from "../src/core/provider-client.js";
const registry=new ModelRegistry();
registry.register({id:"local-test",provider:"local",capabilities:["chat"],local:true,enabled:true,priority:1});
registry.register({id:"cloud-test",provider:"cloud",capabilities:["chat"],local:false,enabled:true,priority:2});
const client:ModelClient={generate:async r=>({provider:"local",model:r.model,output:"ok"})};
const router=new ProviderRouter(new ModelRouter(registry),new Map([["local",client]]));
const result=await router.generate("chat","hello");
if(result.output!=="ok"||result.provider!=="local")throw new Error("Provider routing test failed");
console.log("Provider routing test passed.");

import {createOllamaProvider} from "../src/providers/ollama-provider.js";

let ollamaCalls=0;
const ollamaFetch:typeof fetch=async(_input,init)=>{
 ollamaCalls++;
 if(init?.method==="GET")return new Response(JSON.stringify({models:[{name:"qwen2.5:3b"}]}),{status:200,headers:{"content-type":"application/json"}});
 if(ollamaCalls===1)return new Response(JSON.stringify({error:"model not found"}),{status:404});
 return new Response(JSON.stringify({message:{content:"fallback works"}}),{status:200,headers:{"content-type":"application/json"}});
};
const ollama=createOllamaProvider({baseUrl:"http://ollama.test",fetcher:ollamaFetch});
const ollamaResult=await ollama.generate(
 {id:"llama3.2:3b",provider:"ollama",capabilities:["chat"],local:true,enabled:true,priority:1},
 {capability:"chat",input:"hello"}
);
if(ollamaResult.modelId!=="qwen2.5:3b"||ollamaResult.output!=="fallback works")throw new Error("Ollama installed-model fallback failed");
console.log("Ollama installed-model fallback passed.");
