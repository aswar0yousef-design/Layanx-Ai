import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {CoreRuntime} from "../src/core/core-runtime.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-core-persist-"));
const core=new LayanXCore();
core.registerAgent({
  agentId:"persistent-agent",
  purpose:"persistence",
  allowedTools:["echo"],
  forbiddenResources:["secrets"],
  requiredPermission:"L1_READ",
  maxToolCalls:5,
  maxRuntimeMs:10000,
  successCriteria:["echo"],
  stopCondition:"stop"
});
core.tools.register({name:"echo",description:"echo",permission:"L1_READ",dangerous:false});

const runtime=CoreRuntime.withJsonPersistence(core,join(dir,"runtime.json"));
const result=await runtime.run(
  "persisted integration mission",
  {agentId:"persistent-agent",tool:"echo",action:"echo",permission:"L1_READ",idempotencyKey:crypto.randomUUID(),payload:"hello"},
  {execute:async request=>request.payload}
);
if(!result.ok||!result.verified)throw new Error(result.error??"Persistent CoreRuntime execution failed.");

const restored=await runtime.restorePersistedMission(result.missionId);
if(restored?.mission.status!=="completed")throw new Error("Completed mission was not durably persisted.");
if(restored.executionState.status!=="completed")throw new Error("Completed execution state was not durably persisted.");
if(restored.ledger.length<2)throw new Error("Durable ledger snapshot is incomplete.");

await rm(dir,{recursive:true,force:true});
console.log("CoreRuntime persistence integration test passed.");
