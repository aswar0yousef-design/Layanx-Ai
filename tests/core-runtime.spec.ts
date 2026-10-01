import {LayanXCore} from "../src/core/orchestrator.js";
import {CoreRuntime} from "../src/core/core-runtime.js";

const core=new LayanXCore();
core.registerAgent({agentId:"integration-agent",purpose:"integration",allowedTools:["echo"],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:5,maxRuntimeMs:10000,successCriteria:["echo"],stopCondition:"stop"});
core.tools.register({name:"echo",description:"echo",permission:"L1_READ",dangerous:false});
const runtime=new CoreRuntime(core);
const result=await runtime.run("integration mission",{agentId:"integration-agent",tool:"echo",action:"echo",permission:"L1_READ",idempotencyKey:crypto.randomUUID(),payload:"hello"},{execute:async request=>request.payload});
if(!result.ok||!result.verified)throw new Error(result.error??"CoreRuntime integration failed.");
if(core.capabilities.active().length!==0)throw new Error("Mission capability was not revoked after successful execution.");
if(core.ledger.forMission(result.missionId).length<2)throw new Error("Mission ledger is incomplete.");

const blocked=await runtime.run("elevated mission",{agentId:"integration-agent",tool:"echo",action:"echo",permission:"L4_EXECUTE",idempotencyKey:crypto.randomUUID(),payload:"blocked"},{execute:async request=>request.payload});
if(blocked.ok||blocked.decision!=="blocked")throw new Error("Elevated execution was not blocked without an explicit capability.");

console.log("CoreRuntime integration test passed.");
