import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {MissionRunner} from "../src/core/mission-runner.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-full-cycle-"));
const persistence=new RuntimePersistence(RuntimeStorage.json(join(dir,"runtime.json")));
const core=new LayanXCore(undefined,persistence);
core.registerAgent({
  agentId:"cycle-agent",
  purpose:"execute bounded cycle tests",
  allowedTools:["cycle-tool"],
  forbiddenResources:["secrets"],
  requiredPermission:"L4_EXECUTE",
  maxToolCalls:5,
  maxRuntimeMs:10000,
  successCriteria:["cycle completed"],
  stopCondition:"stop"
});
core.tools.register({name:"cycle-tool",description:"execute cycle action",permission:"L4_EXECUTE",dangerous:false});

const mission=core.startMission("full runtime cycle");
mission.steps=[
 {id:"plan",description:"Plan mission",status:"completed"},
 {id:"execute",description:"Execute cycle action",status:"pending"},
 {id:"verify",description:"Verify cycle result",status:"pending"}
];
const capability=core.capabilities.issue({
 missionId:mission.id,agentId:"cycle-agent",projectId:"cycle-project",
 resource:"cycle-tool",permission:"L4_EXECUTE",
 expiresAt:new Date(Date.now()+60000).toISOString()
});
const runner=new MissionRunner(core);
let calls=0;
const result=await runner.execute(
 mission,
 {missionId:mission.id,agentId:"cycle-agent",tool:"cycle-tool",action:"execute cycle",permission:"L4_EXECUTE",idempotencyKey:"full-cycle",payload:"ok"},
 async request=>{
   calls++;
   if(calls===1)throw new Error("temporary provider failure");
   return{ok:true,data:request.payload};
 },
 undefined,
 {projectId:"cycle-project",capabilityId:capability.id}
);
if(!result.ok||!result.verified)throw new Error("Full runtime cycle did not recover and verify.");
if(calls!==2)throw new Error("Recovery cycle did not perform exactly one retry.");
if(mission.status!=="completed")throw new Error("Replanned mission did not reach completed state.");
if(mission.steps.find(step=>step.id==="execute")?.status!=="completed")throw new Error("Execution step was not completed.");
if(mission.steps.find(step=>step.id==="verify")?.status!=="completed")throw new Error("Verification step was not completed.");

const snapshot=await persistence.get(mission.id);
if(!snapshot)throw new Error("Final runtime snapshot was not persisted.");
if(snapshot.mission.status!=="completed"||snapshot.executionState.status!=="completed")
 throw new Error("Final persisted runtime state is not completed.");
const records=(await core.idempotency.list()).filter(record=>record.missionId===mission.id);
if(!records.some(record=>record.key==="full-cycle"&&record.status==="failed"))throw new Error("Initial failed idempotency record was not retained.");
if(!records.some(record=>record.key==="full-cycle:retry:1"&&record.status==="completed"))throw new Error("Retry idempotency record was not completed.");

const handoff=core.handoffs.create({
 missionId:mission.id,fromAgentId:"cycle-agent",
 toAgent:{agentId:"handoff-agent",purpose:"handoff",allowedTools:["cycle-tool"],forbiddenResources:["secrets"],requiredPermission:"L4_EXECUTE",maxToolCalls:2,maxRuntimeMs:5000,successCriteria:["handoff"],stopCondition:"stop"},
 goal:"continue verified result",context:{verified:true},requiredPermission:"L4_EXECUTE"
});
core.handoffs.accept(handoff.id);
core.handoffs.complete(handoff.id);
await core.executionRuntime.persist(mission);
const withHandoff=await persistence.get(mission.id);
if(!withHandoff?.handoffs?.some(item=>item.id===handoff.id&&item.status==="completed"))
 throw new Error("Completed handoff was not persisted.");

core.capabilities.revoke(capability.id);
await rm(dir,{recursive:true,force:true});
console.log("Full runtime cycle passed: failure -> replan -> retry -> verification -> memory/persistence -> handoff.");
