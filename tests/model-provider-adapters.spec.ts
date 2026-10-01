import {createOpenAIProvider} from "../src/providers/openai-provider.js";
import {createOllamaProvider} from "../src/providers/ollama-provider.js";

const testCredential="unit-token";

const model={id:"test-model",provider:"openai",capabilities:["chat"] as const,local:false,enabled:true,priority:1};

let lastBody="";
const openai=createOpenAIProvider({apiKey:testCredential,fetcher:async(input,init)=>{
 if(init?.method==="GET")return new Response("",{status:200});
 lastBody=String(init?.body);
 return new Response(JSON.stringify({output_text:"hello",usage:{input_tokens:3,output_tokens:4}}),{status:200});
}});
const health=await openai.health();
if(!health.available)throw new Error("OpenAI health check failed.");
const response=await openai.generate(model,{capability:"chat",input:"hi",maxOutputTokens:10});
if(response.output!=="hello"||response.usage?.outputTokens!==4)throw new Error("OpenAI response parsing failed.");
if(!lastBody.includes('"model":"test-model"'))throw new Error("OpenAI request body is incorrect.");

const ollama=createOllamaProvider({fetcher:async(input,init)=>{
 if(init?.method==="GET")return new Response("",{status:200});
 return new Response(JSON.stringify({response:"local hello",prompt_eval_count:2,eval_count:5}),{status:200});
}});
const local=await ollama.generate({...model,id:"llama3.2:3b",provider:"ollama",local:true},{capability:"chat",input:"hello"});
if(local.provider!=="ollama"||local.output!=="local hello"||local.usage?.outputTokens!==5)throw new Error("Ollama response parsing failed.");

const failed=createOpenAIProvider({apiKey:"unit-token",fetcher:async()=>new Response("",{status:503})});
if((await failed.health()).available)throw new Error("Unavailable provider reported healthy.");

console.log("Model provider adapter tests passed.");
