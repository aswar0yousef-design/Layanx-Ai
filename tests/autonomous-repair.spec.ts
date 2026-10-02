import {AutonomousRepairLoop} from "../src/core/autonomous-repair.js";

const loop=new AutonomousRepairLoop();

if(loop.normalizeAttempts(undefined)!==3)throw new Error("Default repair attempts mismatch.");
if(loop.normalizeAttempts(0)!==1)throw new Error("Repair attempt lower bound failed.");
if(loop.normalizeAttempts(99)!==5)throw new Error("Repair attempt upper bound failed.");

if(!loop.isRepairCandidate({ok:false,missionId:"m",verified:false,recoverable:true}))throw new Error("Recoverable failure was not classified as repairable.");
if(loop.isRepairCandidate({ok:false,missionId:"m",verified:false,recoverable:false}))throw new Error("Non-recoverable failure was classified as repairable.");
if(!loop.isSafeRepairPermission("L3_MODIFY")||!loop.isSafeRepairPermission("L4_EXECUTE"))throw new Error("Valid repair permissions rejected.");
if(loop.isSafeRepairPermission("L5_CRITICAL"))throw new Error("Critical permission crossed the autonomous repair boundary.");

console.log("Autonomous repair policy tests passed.");
