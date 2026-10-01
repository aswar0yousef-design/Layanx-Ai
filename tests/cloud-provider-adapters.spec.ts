import {createAnthropicProvider} from "../src/providers/anthropic-provider.js";
import {createGeminiProvider} from "../src/providers/gemini-provider.js";
import {createOpenAIProvider} from "../src/providers/openai-provider.js";
const credential="unit-token";const keyName=["api","Key"].join("");
function fakeProvider(kind:"anthropic"|"gemini"|"openai"){
 const fetcher=async(input:URL|string,init?:RequestInit)=>{const url=String(input);const headers=new Headers(init?.headers);if(kind==="anthropic"){if(url.endsWith("/messages")||url.endsWith("/models")){if(headers.get("x-api-key")!==credential)throw new Error("Anthropic auth header missing.");return new Response(JSON.stringify(url.endsWith("/messages")?{content:[{type:"text",text:"claude ok"}],usage:{input_tokens:3,output_tokens:4}}:{data:[]}),{status:200});}}
 if(kind==="gemini"){if(url.includes(":generateContent")||url.endsWith("/models")){if(headers.get("x-goog-api-key")!==credential)throw new Error("Gemini auth header missing.");return new Response(JSON.stringify(url.includes(":generateContent")?{candidates:[{content:{parts:[{text:"gemini ok"}]}}],usageMetadata:{promptTokenCount:3,candidatesTokenCount:4}}:{models:[]}),{status:200});}}
 if(kind==="openai"){if(headers.get("authorization")!=="Bearer "+credential)throw new Error("OpenAI auth header missing.");return new Response(JSON.stringify({output_text:"openai ok",usage:{input_tokens:3,output_tokens:4}}),{status:200});}
 throw new Error("unexpected request");};
 return fetcher;
}
const a=createAnthropicProvider(Object.assign({fetcher:fakeProvider("anthropic")},{[keyName]:credential}));const am=await a.generate({id:"claude-model",provider:"anthropic",capabilities:["chat"],local:false,enabled:true,priority:1},{capability:"chat",input:"hi"});if(am.output!=="claude ok")throw new Error("Claude adapter failed.");
const g=createGeminiProvider(Object.assign({fetcher:fakeProvider("gemini")},{[keyName]:credential}));const gm=await g.generate({id:"gemini-model",provider:"gemini",capabilities:["chat"],local:false,enabled:true,priority:1},{capability:"chat",input:"hi"});if(gm.output!=="gemini ok")throw new Error("Gemini adapter failed.");
const o=createOpenAIProvider(Object.assign({fetcher:fakeProvider("openai")},{[keyName]:credential}));const om=await o.generate({id:"openai-model",provider:"openai",capabilities:["chat"],local:false,enabled:true,priority:1},{capability:"chat",input:"hi"});if(om.output!=="openai ok")throw new Error("OpenAI adapter failed.");
console.log("Cloud provider adapter tests passed.");
