import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-runtime-"));
const persistence=new RuntimePersistence(RuntimeStorage.json(join(dir,"runtime.json")));
const snapshot={
  mission:{id:"m1",goal:"persist mission",status:"completed" as const,risk:"low" as const,requiredPermission:"L1_READ" as const,steps:[],createdAt:new Date().toISOString()},
  executionState:{missionId:"m1",startedAt:new Date().toISOString(),toolCalls:1,runtimeMs:12,costUsd:0,status:"completed" as const},
  ledger:[],
  audit:[],
  savedAt:new Date().toISOString()
};
await persistence.saveAtomic(snapshot);
const restored=await persistence.get("m1");
if(restored?.mission.goal!=="persist mission")throw new Error("Runtime snapshot restore failed.");
if(restored?.executionState.status!=="completed")throw new Error("Execution state was not persisted.");
await rm(dir,{recursive:true,force:true});
console.log("Runtime persistence test passed.");
