import {ApprovalEngine} from "../src/security/approval.js";
const engine=new ApprovalEngine();
const req=engine.create({missionId:"m1",agentId:"a1",action:"deploy",permission:"L4_EXECUTE",reason:"production deployment",expiresAt:new Date(Date.now()+60000).toISOString()});
engine.approve(req.id);
if(!engine.authorize(req.id,{missionId:"m1",agentId:"a1",action:"deploy",permission:"L4_EXECUTE"}).allowed)throw new Error("Scoped approval failed.");
if(engine.authorize(req.id,{missionId:"m2",agentId:"a1",action:"deploy",permission:"L4_EXECUTE"}).allowed)throw new Error("Approval scope bypassed.");
engine.revoke(req.id);
if(engine.isApproved(req.id))throw new Error("Approval revoke failed.");
console.log("Approval scope test passed.");
