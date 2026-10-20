import {ToolScopeGuard} from "../src/security/tool-scope.js";
const guard=new ToolScopeGuard();
const scope={tool:"git.status",projectId:"Project-A",missionId:"m1",permission:"L1_READ" as const,allowedActions:["status"],expiresAt:new Date(Date.now()+60000).toISOString()};
const result=guard.validate(scope,{tool:"git.status",projectId:"project-a",missionId:"m1",permission:"L1_READ",action:"status"});
if(process.platform==="win32"&&!result.allowed)throw new Error("Windows tool scope should accept equivalent project casing.");
if(process.platform!=="win32"&&result.allowed)throw new Error("Non-Windows tool scope must remain case-sensitive.");
const mismatch=guard.validate(scope,{tool:"git.status",projectId:"project-b",missionId:"m1",permission:"L1_READ",action:"status"});
if(mismatch.allowed)throw new Error("Cross-project tool scope was accepted.");
console.log("Tool scope project-casing test passed.");
