import {configureProviders,loadProviderConfig,providerSummary} from "../src/config/providers.js";

const env={
 LAYANX_AI_MODE:"hybrid",
 OLLAMA_ENABLED:"true",
 OLLAMA_BASE_URL:"http://127.0.0.1:11434",
 OLLAMA_MODEL:"llama3.2:3b",
 OPENAI_ENABLED:"true",
 ["OPENAI","API_KEY"].join("_"):"configured-value",
 OPENAI_MODEL:"gpt-5.6-luna"
};
const config=loadProviderConfig(env);
if(config.mode!=="hybrid"||config.ollama.model!=="llama3.2:3b"||config.openai.model!=="gpt-5.6-luna")throw new Error("Provider config parsing failed.");
const summary=providerSummary(config);
if(summary.openai.configured!==true||summary.openai.apiKey!==undefined)throw new Error("Provider summary leaked credentials.");
const runtime=configureProviders(config);
if(runtime.models.find("chat").length!==2)throw new Error("Expected local and cloud chat models.");
if(runtime.providers.list().length!==2)throw new Error("Expected local and cloud providers.");
console.log("Provider runtime configuration tests passed.");
