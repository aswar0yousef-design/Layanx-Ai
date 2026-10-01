import {AuditLog} from "../src/core/audit.js";
const audit=new AuditLog();
const secret="SUPER_SECRET_TEST_TOKEN_123";
audit.append({timestamp:new Date().toISOString(),actor:"agent",action:"request",resource:"provider",result:"failure",metadata:{missionId:"m1",apiKey:secret,nested:{authorization:"Bearer abcdefghijk",safe:"ok"}}});
const events=audit.forMission("m1");
const serialized=JSON.stringify(events);
if(serialized.includes(secret)||serialized.includes("Bearer abcdefghijk"))throw new Error("Sensitive audit metadata leaked.");
if(!serialized.includes("[REDACTED]"))throw new Error("Audit redaction marker missing.");
console.log("Audit redaction test passed.");