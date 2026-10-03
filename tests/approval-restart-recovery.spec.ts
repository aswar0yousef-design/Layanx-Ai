import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
import {JsonStorageAdapter} from "../src/storage/json-adapter.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-approval-restart-"));
const persistence=new RuntimePersistence(new RuntimeStorage(new JsonStorageAdapter(join(dir,"runtime.json"))));

function setup(core:LayanXCore){
 core.registerAgent({agentId:"core",purpose:"approval restart",allowedTools:["dangerous.read"],forbiddenResources:[],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["approved"],stopCondition:"stop"});
 core.tools.register({name:"dangerous.read",description:"approval test",permission:"L1_READ",dangerous:true,actions:["run sensitive test"],tags:["test"]});
 core.toolAdapters.register("dangerous.read",{async execute(){return{approved:true};}});
}

try{
 const first=new LayanXCore(undefined,persistence);
 setup(first);
 const mission=first.startMission("approval restart");
 mission.projectId="approval-restart-project";
 mission.requiredPermission="L1_READ";
 mission.tools=[{tool:"dangerous.read",action:"run sensitive test",permission:"L1_READ",reason:"restart test"}];

 const blocked=await first.executeMissionTool(mission.id,mission.projectId,0,{});
 if(blocked.ok||!blocked.approvalId)throw new Error("Approval request was not created.");
 const snapshot=await persistence.get(mission.id);
 if(!snapshot?.approvals?.requests.some(request=>request.id===blocked.approvalId))throw new Error("Approval request was not persisted.");

 const restarted=new LayanXCore(undefined,persistence);
 setup(restarted);
 const restored=await persistence.get(mission.id);
 if(!restored)throw new Error("Persisted mission missing after restart.");
 restarted.restoreRuntimeSnapshot(restored);
 const approval=restarted.executionRuntime.approvals.get(blocked.approvalId);
 restarted.executionRuntime.approvals.approve(approval.id);
 const resumed=await restarted.executeMissionTool(mission.id,mission.projectId,0,{},approval.id);
 if(!resumed.ok||!resumed.verified)throw new Error(resumed.error??"Persisted approval did not resume execution.");
 if(restarted.missions.get(mission.id)?.status!=="completed")throw new Error("Restarted mission did not complete.");
 console.log("Approval restart recovery passed.");
}finally{
 await rm(dir,{recursive:true,force:true});
}
