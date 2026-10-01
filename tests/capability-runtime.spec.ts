import {LayanXCore} from "../src/core/orchestrator.js";
const core=new LayanXCore();
const token=core.capabilities.issue({missionId:"m1",agentId:"a1",projectId:"p1",resource:"echo",permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()});
if(!core.capabilities.active().some(t=>t.id===token.id))throw new Error("Capability was not active.");
core.capabilities.revokeMission("m1");
if(core.capabilities.active().some(t=>t.id===token.id))throw new Error("Mission capability was not revoked.");
console.log("Capability lifecycle test passed.");
