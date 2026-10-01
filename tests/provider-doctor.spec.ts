import {providerDoctor} from "../src/doctor.js";
process.env.LAYANX_AI_MODE="local"; process.env.OLLAMA_ENABLED="true"; process.env.OLLAMA_BASE_URL="http://ollama.test"; process.env.OLLAMA_MODEL="llama3.2:3b";
const ready=await providerDoctor(async(input,init)=>{if(input!=="http://ollama.test/api/tags"||init?.method!=="GET")throw new Error("Unexpected request.");return new Response(JSON.stringify({models:[{name:"llama3.2:3b"}]}),{status:200});});
if(!ready.ok||!ready.providers[0]?.modelAvailable)throw new Error("Installed model was not detected.");
const missing=await providerDoctor(async()=>new Response(JSON.stringify({models:[]}),{status:200}));
if(missing.ok||missing.providers[0]?.modelAvailable)throw new Error("Missing model was reported ready.");
console.log("Provider doctor test passed.");
