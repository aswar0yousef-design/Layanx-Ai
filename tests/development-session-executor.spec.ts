import {LayanXCore} from "../src/core/orchestrator.js";
import {registerBuiltinTools,registerToolFabric} from "../src/tools/builtin.js";
import type {Mission} from "../src/core/types.js";

const core=new LayanXCore();
registerBuiltinTools(core);registerToolFabric(core,{workspaceRoot:process.cwd()});
const mission:Mission={
 id:"session-test",goal:"test development session",status:"planned",risk:"high",requiredPermission:"L4_EXECUTE",
 steps:[{id:"s1",description:"Execute with checkpoints",status:"pending"}],
 tools:[{tool:"git.commit",action:"git commit",permission:"L4_EXECUTE",reason:"test",payload:{message:"test"}}],
 createdAt:new Date().toISOString(),projectId:"session-test-project"
};
core.missions.save(mission);
const paused=await core.executeDevelopmentSession(mission.id,"session-test-project");
if(!paused.paused||paused.nextToolIndex!==0||paused.missingApprovals?.[0]!==0)throw new Error("Session did not pause for missing approval.");
if(core.missions.get(mission.id)?.status!=="planned")throw new Error("Preflight must not mutate mission state.");
console.log("Development session approval preflight passed.");
