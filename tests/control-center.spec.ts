import {LayanXCore} from "../src/core/orchestrator.js";
import {ControlCenter} from "../src/control-center.js";

const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"control",allowedTools:[],forbiddenResources:[],requiredPermission:"L1_READ",maxToolCalls:10,maxRuntimeMs:1000,successCriteria:[],stopCondition:"stop"});
const missionA=core.startMission("project a","project-a");
const missionB=core.startMission("project b","project-b");
const control=new ControlCenter(core);
const all=control.snapshot();
if(all.missions.length!==2)throw new Error("Control center mission snapshot is incomplete.");
const scoped=control.snapshot("project-a");
if(scoped.missions.length!==1||scoped.missions[0]?.id!==missionA.id)throw new Error("Control center project filter failed.");
if(scoped.missions.some(m=>m.projectId!=="project-a"))throw new Error("Control center leaked another project.");
control.cancel(missionA.id,"project-a");
if(core.missions.get(missionA.id)?.status!=="cancelled")throw new Error("Mission cancellation failed.");
try{control.cancel(missionB.id,"project-a");throw new Error("Cross-project cancellation was accepted.");}
catch(error){if(!(error instanceof Error)||!error.message.includes("Project isolation"))throw error;}
if(core.missions.get(missionB.id)?.status==="cancelled")throw new Error("Cross-project mission was changed.");
console.log("Control center tests passed.");
