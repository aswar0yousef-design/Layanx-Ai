import {LayanXCore} from "../src/core/orchestrator.js";

const core=new LayanXCore();
const makeMission=(id:string,status:any="planned",projectId="p")=>core.missions.save({
  id,goal:id,status,risk:"low",requiredPermission:"L1_READ",steps:[],createdAt:new Date().toISOString(),projectId
});

makeMission("a","completed");
makeMission("b");
makeMission("c");
core.registerMissionDependencies("b",["a"],"p");
const ready=core.missionDependencyStatus("b");
if(ready.state!=="completed"||ready.completedDependencies[0]!=="a")throw new Error("Completed mission dependency was not resolved.");

core.registerMissionDependencies("c",["b"],"p");
const pending=core.missionDependencyStatus("c");
if(pending.state!=="pending"||pending.pendingDependencies[0]!=="b")throw new Error("Pending mission dependency was not detected.");

core.missions.save({...core.missions.get("b")!,status:"failed"});
let blocked=false;
try{core.missionDependencies.assertReady("c");}catch(error){blocked=true;if(!(error instanceof Error)||!error.message.includes("Mission dependency failed"))throw error;}
if(!blocked||core.missions.get("c")?.status!=="blocked")throw new Error("Failed dependency did not block downstream mission.");

makeMission("d");
core.registerMissionDependencies("d",["a"],"p");
let cycle=false;
try{core.registerMissionDependencies("a",["d"],"p");}catch(error){cycle=true;}
if(!cycle)throw new Error("Mission dependency cycle was not rejected.");

makeMission("isolated","planned","q");
let isolated=false;
try{core.registerMissionDependencies("c",["isolated"],"p");}catch(error){isolated=true;}
if(!isolated)throw new Error("Cross-project dependency was not rejected.");

console.log("Mission dependency tests passed.");
