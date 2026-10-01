import {CapabilityTokenService} from "../src/security/capability-token.js";
const service=new CapabilityTokenService();
const token=service.issue({missionId:"m1",agentId:"a1",projectId:"p1",resource:"repo",permission:"L3_MODIFY",expiresAt:new Date(Date.now()+60000).toISOString()});
const ok=service.validate(token,{missionId:"m1",agentId:"a1",projectId:"p1",resource:"repo",permission:"L2_ANALYZE"});
if(!ok.allowed)throw new Error("Capability token validation failed.");
const blocked=service.validate(token,{missionId:"m2",agentId:"a1",projectId:"p1",resource:"repo",permission:"L2_ANALYZE"});
if(blocked.allowed)throw new Error("Capability token scope bypassed.");
console.log("Capability scope test passed.");
