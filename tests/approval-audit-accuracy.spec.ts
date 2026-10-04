import {createHash} from "node:crypto";
import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
core.registerAgent({
 agentId:"core",purpose:"test",allowedTools:["sensitive.read"],forbiddenResources:[],
 requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["approved"],stopCondition:"stop"
});
core.tools.register({
 name:"sensitive.read",description:"test sensitive action",permission:"L1_READ",dangerous:false,
 actions:["delete record"],tags:["test"]
});
core.toolAdapters.register("sensitive.read",{async execute(){return{approved:true};}});

const mission=core.startMission("Execute approved sensitive test","project");
mission.projectId="security-audit-project";
core.missions.save(mission);
mission.requiredPermission="L1_READ";
mission.tools=[{tool:"sensitive.read",action:"delete record",permission:"L1_READ",reason:"approval audit test"}];

const payload={};
const payloadHash=createHash("sha256").update(JSON.stringify(payload)).digest("hex");
const approval=core.executionRuntime.approvals.create({
 missionId:mission.id,agentId:"core",tool:"sensitive.read",action:"delete record",
 permission:"L1_READ",payloadHash,reason:"test approval",
 expiresAt:new Date(Date.now()+60000).toISOString()
});
core.executionRuntime.approvals.approve(approval.id);

const result=await core.executeMissionTool(mission.id,mission.projectId,0,payload,approval.id);
if(!result.ok||!result.verified)throw new Error(result.error??"Approved sensitive execution failed.");
const audit=core.audit.forMission(mission.id);
const riskEvent=audit.find(event=>event.action==="delete record"&&event.metadata?.risk==="medium");
if(!riskEvent||riskEvent.result!=="pending_approval")throw new Error("Risk audit did not record pending approval accurately.");
const successEvent=audit.filter(event=>event.action==="delete record"&&event.result==="success").at(-1);
if(!successEvent)throw new Error("Approved execution did not produce a success audit event.");

console.log("Approval audit accuracy test passed.");
