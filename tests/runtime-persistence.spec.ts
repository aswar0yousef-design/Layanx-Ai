import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {RuntimeStorage} from "../src/storage/runtime-storage.js";
import {RuntimePersistence} from "../src/core/runtime-persistence.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-runtime-"));
const storage=RuntimeStorage.json(join(dir,"runtime.json"));
const persistence=new RuntimePersistence(storage);
const snapshot={
  mission:{id:"m1",goal:"persist mission",status:"completed" as const,risk:"low" as const,requiredPermission:"L1_READ" as const,steps:[],createdAt:new Date().toISOString()},
  executionState:{missionId:"m1",startedAt:new Date().toISOString(),toolCalls:1,runtimeMs:12,costUsd:0,status:"completed" as const},
  ledger:[],
  audit:[],
  savedAt:new Date().toISOString(),schemaVersion:1
};
await persistence.saveAtomic(snapshot);
const restored=await persistence.get("m1");
if(restored?.mission.goal!=="persist mission")throw new Error("Runtime snapshot restore failed.");
if(restored?.executionState.status!=="completed")throw new Error("Execution state was not persisted.");
console.log("Runtime persistence test passed.");


const invalid={...snapshot,schemaVersion:99};
try{
  await persistence.saveAtomic(invalid);
  throw new Error("Unsupported snapshot version was accepted.");
}catch(error){
  if(!(error instanceof Error)||!error.message.includes("Unsupported runtime snapshot version.")) throw error;
}

const mismatch={...snapshot,executionState:{...snapshot.executionState,missionId:"other"}};
try{
  await persistence.saveAtomic(mismatch);
  throw new Error("Mission/state mismatch was accepted.");
}catch(error){
  if(!(error instanceof Error)||!error.message.includes("mission/state mismatch")) throw error;
}

const legacyStorage=RuntimeStorage.json(join(dir,"legacy.json"));
await legacyStorage.set([{...snapshot,schemaVersion:0}]);
const migrated=new RuntimePersistence(legacyStorage,[{
  from:0,to:1,up:value=>({...value as typeof snapshot,schemaVersion:1})
}]);
const migratedSnapshot=await migrated.get("m1");
if(migratedSnapshot?.schemaVersion!==1)throw new Error("Legacy runtime snapshot was not migrated.");

const oldSnapshot={...snapshot,savedAt:new Date(Date.now()-2*24*60*60*1000).toISOString()};
const activeSnapshot={...snapshot,mission:{...snapshot.mission,id:"active",status:"running" as const},executionState:{...snapshot.executionState,missionId:"active",status:"running" as const},savedAt:new Date(Date.now()-2*24*60*60*1000).toISOString()};
await storage.set([oldSnapshot,activeSnapshot]);
const cleanup=await persistence.cleanup(24*60*60*1000);
if(cleanup.removed!==1)throw new Error("Snapshot retention cleanup did not remove the expired snapshot.");
if(!(await persistence.get("active")))throw new Error("Snapshot cleanup removed a resumable mission.");
await rm(dir,{recursive:true,force:true});
