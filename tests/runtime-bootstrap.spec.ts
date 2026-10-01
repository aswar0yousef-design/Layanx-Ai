process.env.LAYANX_AI_MODE="hybrid";
process.env.OLLAMA_ENABLED="true";
process.env.OPENAI_ENABLED="false";

const {createRuntime,runtimeStatus}=await import("../src/runtime.js");
const runtime=createRuntime();
if(!runtime.core.isReady())throw new Error("Runtime should be ready after core agent registration.");
if(runtime.providers.list().length!==1)throw new Error("Expected only local provider when cloud is disabled.");
const status=runtimeStatus(runtime);
if(status.providers.openai.configured!==false)throw new Error("Disabled cloud provider should not be configured.");
if(!status.models.some(model=>model.provider==="ollama"))throw new Error("Local model was not registered.");
console.log("Runtime bootstrap tests passed.");
