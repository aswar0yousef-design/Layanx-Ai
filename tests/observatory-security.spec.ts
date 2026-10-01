import {MissionObservatory} from "../src/core/observatory.js";
const observatory=new MissionObservatory();
const audit=[{timestamp:new Date().toISOString(),actor:"a",action:"x",resource:"r",result:"success" as const,metadata:{missionId:"m"}}];
const ledger=[{id:"l",missionId:"m",agentId:"a",action:"x",status:"completed" as const,timestamp:new Date().toISOString(),detail:"ok"}];
const snapshot=observatory.snapshot({
 missions:[{missionId:"m",startedAt:new Date().toISOString(),toolCalls:1,runtimeMs:10,costUsd:0,status:"completed"}],
 agents:1,
 providers:[{provider:"p",available:true,updatedAt:new Date().toISOString()}],
 audit,
 ledger
});
snapshot.recentAudit[0]!.metadata!.missionId="changed";
if(audit[0]!.metadata!.missionId!=="m")throw new Error("Observatory audit snapshot is not isolated.");
snapshot.recentLedger[0]!.detail="changed";
if(ledger[0]!.detail!=="ok")throw new Error("Observatory ledger snapshot is not isolated.");
if(snapshot.missions.completed!==1||snapshot.providers.healthy!==1)throw new Error("Observatory counters are incorrect.");
console.log("Observatory isolation test passed.");