import {runOperationalAcceptance} from "../src/operational-acceptance.js";

process.env.LAYANX_AI_MODE="local";
process.env.OLLAMA_ENABLED="true";
process.env.OLLAMA_BASE_URL="http://acceptance.test";
process.env.OLLAMA_MODEL="llama3.2:3b";

const result=await runOperationalAcceptance({
  core:{
    isReady:()=>true,
    tools:{list:()=>[{name:"runtime.status"},{name:"mission.inspect"}]},
  } as never,
  models:{list:()=>[{id:"acceptance-model",provider:"acceptance-provider"}]} as never,
  providers:{
    list:()=>[{name:"acceptance-provider",health:async()=>({provider:"acceptance-provider",available:true,updatedAt:new Date().toISOString()})}]
  } as never,
  persistence:undefined
} as never,{requireLiveProviders:false});

if(!result.reviewedTwice)throw new Error("Operational acceptance did not perform the readiness double review.");
if(!result.accepted)throw new Error("Operational acceptance rejected a structurally valid runtime.");
if(!result.checks.some(check=>check.id==="unique-tool-identities"&&check.ok))throw new Error("Tool uniqueness gate failed.");
if(!result.checks.some(check=>check.id==="acceptance-no-duplicate-registration"&&check.ok))throw new Error("Duplicate registration gate failed.");
console.log("Operational acceptance contract test passed.");
