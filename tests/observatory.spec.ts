import {MissionObservatory} from "../src/core/observatory.js";
const o=new MissionObservatory();
const s=o.snapshot({missions:[{missionId:"m",startedAt:new Date().toISOString(),toolCalls:2,runtimeMs:10,costUsd:.1,status:"running"}],agents:2,providers:[{provider:"local",available:true,updatedAt:new Date().toISOString()}],audit:[],ledger:[]});
if(s.missions.running!==1||s.providers.healthy!==1||s.execution.toolCalls!==2)throw new Error("Observatory snapshot failed");
console.log("Observatory test passed.");
