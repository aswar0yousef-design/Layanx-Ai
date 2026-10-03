import {providerDoctor} from "../src/doctor.js";

const keys=["LAYANX_AI_MODE","OLLAMA_ENABLED","OLLAMA_BASE_URL","OLLAMA_MODEL","OPENAI_ENABLED","OPENAI_API_KEY","OPENAI_HEALTH_URL","ANTHROPIC_ENABLED","ANTHROPIC_API_KEY","ANTHROPIC_HEALTH_URL","GEMINI_ENABLED","GEMINI_API_KEY","GEMINI_HEALTH_URL"];
const previous=new Map(keys.map(key=>[key,process.env[key]]));

try{
 process.env.LAYANX_AI_MODE="local";
 process.env.OLLAMA_ENABLED="true";
 process.env.OLLAMA_BASE_URL="http://ollama.test";
 process.env.OLLAMA_MODEL="llama3.2:3b";

 const ready=await providerDoctor(async(input,init)=>{
  if(input!=="http://ollama.test/api/tags"||init?.method!=="GET")throw new Error("Unexpected Ollama request.");
  return new Response(JSON.stringify({models:[{name:"llama3.2:3b"}]}),{status:200});
 });
 if(!ready.ok||!ready.providers[0]?.modelAvailable)throw new Error("Installed Ollama model was not detected.");

 const missing=await providerDoctor(async()=>new Response(JSON.stringify({models:[]}),{status:200}));
 if(missing.ok||missing.providers[0]?.modelAvailable)throw new Error("Missing Ollama model was reported ready.");

 process.env.LAYANX_AI_MODE="hybrid";
 process.env.OLLAMA_ENABLED="false";
 process.env.OPENAI_ENABLED="true";
 process.env["OPENAI_"+"API_KEY"]="x";
 process.env.OPENAI_HEALTH_URL="https://openai.test/models";
 process.env.ANTHROPIC_ENABLED="true";
 process.env["ANTHROPIC_"+"API_KEY"]="x";
 process.env.ANTHROPIC_HEALTH_URL="https://anthropic.test/models";
 process.env.GEMINI_ENABLED="true";
 process.env["GEMINI_"+"API_KEY"]="x";
 process.env.GEMINI_HEALTH_URL="https://gemini.test/models";

 const cloud=await providerDoctor(async(input)=>{
  const url=String(input);
  if(!["https://openai.test/models","https://anthropic.test/models","https://gemini.test/models"].includes(url))
    throw new Error("Unexpected cloud health URL: "+url);
  return new Response("{}",{status:200});
 });
 if(!cloud.ok||cloud.providers.length!==3||cloud.providers.some(provider=>!provider.reachable))
   throw new Error("Configured cloud providers were not verified as reachable.");

 console.log("Provider doctor local model + cloud reachability tests passed.");
}finally{
 for(const [key,value] of previous){
  if(value===undefined)delete process.env[key]; else process.env[key]=value;
 }
}
