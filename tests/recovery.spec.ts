import {LayanXCore} from "../src/core/orchestrator.js";
import {ExecutionRuntime} from "../src/core/runtime.js";

const core=new LayanXCore();
core.registerAgent({agentId:"recovery-test",purpose:"test",allowedTools:["unstable"],forbiddenResources:["secrets"],requiredPermission:"L1_READ",maxToolCalls:3,maxRuntimeMs:10000,successCriteria:["valid steps"],stopCondition:"stop"});
core.tools.register({name:"unstable",description:"test",permission:"L1_READ",dangerous:false});
const mission=core.startMission("Recovery test");
const runtime=new ExecutionRuntime(core);
let attempts=0;
const result=await runtime.run(mission,{missionId:mission.id,agentId:"recovery-test",tool:"unstable",action:"unstable",permission:"L1_READ",idempotencyKey:crypto.randomUUID(),payload:"x"},{execute:async()=>{attempts++;if(attempts===1)throw new Error("transient");return"recovered";}});
if(result.ok)throw new Error("Direct runtime should expose transient failure.");
if(!result.recoverable)throw new Error("Transient execution failure should be recoverable.");
if(mission.status!=="failed")throw new Error("Failed execution must transition mission to failed.");
if(core.executionStates.get(mission.id)?.status!=="failed")throw new Error("Failed execution state must be failed.");
if(!core.recovery.restore(mission.id))throw new Error("Checkpoint was not created.");

const blocked=core.startMission("Blocked recovery test");
const blockedResult=await runtime.run(blocked,{missionId:blocked.id,agentId:"recovery-test",tool:"unstable",action:"blocked-action",permission:"L2_ANALYZE",idempotencyKey:crypto.randomUUID(),payload:"x"},{execute:async()=> "should-not-run"});
if(blockedResult.ok||blockedResult.recoverable)throw new Error("Blocked execution must not be replanned automatically.");
if(blocked.status!=="blocked")throw new Error("Blocked execution must transition mission to blocked.");

console.log("Recovery state transition test passed.");
