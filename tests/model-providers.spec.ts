import {OpenAICompatibleProvider,OllamaProvider} from "../src/models/http-providers.js";
import type {ModelDefinition} from "../src/models/registry.js";

const model:ModelDefinition={id:"demo-model",provider:"cloud",capabilities:["chat"],local:false,enabled:true,priority:1};
const calls:Array<{url:string;init?:RequestInit}>=[];
const fakeFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  calls.push({url:String(input),init});
  if(String(input).endsWith("/chat/completions"))return new Response(JSON.stringify({choices:[{message:{content:"hello from cloud"}}],usage:{prompt_tokens:3,completion_tokens:4}}),{status:200});
  return new Response("ok",{status:200});
};
const cloud=new OpenAICompatibleProvider({name:"cloud",baseUrl:"https://example.test/v1",apiKey:"secret",fetcher:fakeFetch});
const cloudResult=await cloud.generate(model,{capability:"chat",input:"hello"});
if(cloudResult.output!=="hello from cloud"||cloudResult.usage?.inputTokens!==3)throw new Error("OpenAI-compatible provider parsing failed.");
const auth=String(calls[0]?.init?.headers&&new Headers(calls[0].init.headers).get("authorization"));
if(auth!=="Bearer secret")throw new Error("Provider authorization header was not applied.");

const localModel:ModelDefinition={id:"llama3.2:3b",provider:"ollama",capabilities:["chat"],local:true,enabled:true,priority:1};
const ollamaFetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith("/api/tags"))return new Response(JSON.stringify({models:[]}),{status:200});
  return new Response(JSON.stringify({message:{content:"hello local"}}),{status:200});
};
const ollama=new OllamaProvider({baseUrl:"http://127.0.0.1:11434",fetcher:ollamaFetch});
const health=await ollama.health();
if(!health.available)throw new Error("Ollama health probe failed.");
const localResult=await ollama.generate(localModel,{capability:"chat",input:"hello"});
if(localResult.output!=="hello local")throw new Error("Ollama response parsing failed.");

console.log("Model provider adapter test passed.");
