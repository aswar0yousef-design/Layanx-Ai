import {createRuntime,runtimeHealth} from "../src/runtime.js";

const runtime=createRuntime();
const health=await runtimeHealth(runtime);
const ollama=health.providers.find(provider=>provider.provider==="ollama");

if(!ollama?.available){
  console.error(JSON.stringify({ok:false,stage:"health",message:"Ollama is not available. Start Ollama and make sure the configured model is installed.",health},null,2));
  process.exit(2);
}

const result=await runtime.core.modelExecution.execute({
  capability:"reasoning",
  input:"Reply with exactly: LayanX Ollama OK"
});

if(result.provider!=="ollama")throw new Error("Smoke test expected Ollama but received "+result.provider+".");
if(!result.output.trim())throw new Error("Ollama returned an empty response.");

console.log(JSON.stringify({ok:true,provider:result.provider,model:result.modelId,output:result.output.trim(),attempts:result.attempts},null,2));
