import {LayanXCore} from "../src/core/orchestrator.js";
import {ControlCenter} from "../src/control-center.js";

const core=new LayanXCore();
core.registerAgent({
 agentId:"core",
 purpose:"test",
 allowedTools:[],
 forbiddenResources:[],
 requiredPermission:"L4_EXECUTE"
});
const mission=core.startMission("test cancellation","default");
new ControlCenter(core).cancel(mission.id,"default");
const cancelled=core.missions.get(mission.id);
if(cancelled?.status!=="cancelled")throw new Error("Mission was not cancelled.");
if(core.executionStates.get(mission.id)?.status!=="blocked")throw new Error("Cancelled mission execution state was not blocked.");
const audit=core.audit.forMission(mission.id).some(item=>item.action==="mission.cancel"&&item.result==="success");
if(!audit)throw new Error("Cancellation audit record missing.");
console.log("mission cancellation test passed.");
