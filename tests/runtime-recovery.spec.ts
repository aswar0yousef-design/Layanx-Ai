import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {JsonStateStore} from "../src/core/persistence.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-recovery-"));
const store=new JsonStateStore<import("../src/core/runtime-persistence.js").RuntimeSnapshot[]>(join(dir,"runtime.json"));
const persistence=new RuntimePersistence(store);
const now=new Date().toISOString();

await persistence.save({
  mission:{id:"recover-me",goal:"recover",status:"running",risk:"low",requiredPermission:"L1_READ",steps:[],createdAt:now},
  executionState:{missionId:"recover-me",startedAt:now,toolCalls:1,runtimeMs:10,costUsd:0,status:"running"},
  ledger:[],audit:[],savedAt:now
});
await persistence.save({
  mission:{id:"done",goal:"done",status:"completed",risk:"low",requiredPermission:"L1_READ",steps:[],createdAt:now},
  executionState:{missionId:"done",startedAt:now,toolCalls:1,runtimeMs:10,costUsd:0,status:"completed"},
  ledger:[],audit:[],savedAt:now
});

const candidates=await persistence.resumable();
if(candidates.length!==1||candidates[0]?.mission.id!=="recover-me")throw new Error("Resumable mission detection failed.");

await rm(dir,{recursive:true,force:true});
console.log("Recovery candidate test passed.");
