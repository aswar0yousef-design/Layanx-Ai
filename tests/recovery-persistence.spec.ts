import {mkdir,rm} from "node:fs/promises";
import {join} from "node:path";
import {RecoveryPersistence,RECOVERY_RECORD_VERSION} from "../src/release/recovery-persistence.js";
import {RecoveryStateMachine} from "../src/release/recovery-state-machine.js";

const dir=join("/tmp","layanx-recovery-persistence-test");
await rm(dir,{recursive:true,force:true});
await mkdir(dir,{recursive:true});

const persistence=RecoveryPersistence.json(join(dir,"recovery.json"));
const machine=new RecoveryStateMachine();
machine.transition("checking");
machine.transition("recovering");

const record={
 version:RECOVERY_RECORD_VERSION,
 recoveryId:"recovery-1",
 deploymentVersion:"1.1.0",
 deploymentCommitSha:"bad1234",
 deploymentChecksum:"b".repeat(64),
 state:machine.current(),
 attempts:1,
 startedAt:"2026-01-02T00:00:00Z",
 updatedAt:"2026-01-02T00:01:00Z",
 targetVersion:"1.0.0",
 targetCommitSha:"good1234",
 targetChecksum:"c".repeat(64),
 reason:"health check failed"
};

await persistence.save(record);
const loaded=await persistence.get("recovery-1");
if(loaded?.state!=="recovering"||loaded.targetVersion!=="1.0.0"||loaded.attempts!==1)
 throw new Error("Recovery state was not persisted correctly.");

await persistence.clear("recovery-1");
if(await persistence.get("recovery-1"))throw new Error("Recovery state was not cleared.");

let rejected=false;
try{
 await persistence.save({...record,version:99});
}catch(error){
 rejected=error instanceof Error&&error.message.includes("Unsupported recovery record version");
}
if(!rejected)throw new Error("Unsupported recovery record version was accepted.");

await persistence.save(record);
let conflict=false;
try{
 await persistence.save({...record,recoveryId:"recovery-2",state:"recovering"});
}catch(error){
 conflict=error instanceof Error&&error.message.includes("Another recovery operation is already active.");
}
if(!conflict)throw new Error("Concurrent active recovery was not rejected.");

const active=await persistence.findActive();
if(active?.recoveryId!=="recovery-1")throw new Error("Active recovery was not discoverable.");

const firstStartedAt="2026-01-02T00:00:00Z";
const later={...record,state:"verifying" as const,startedAt:"2026-01-03T00:00:00Z",updatedAt:"2026-01-03T00:01:00Z"};
await persistence.save({...record,startedAt:firstStartedAt});
await persistence.save(later);
const preserved=await persistence.get("recovery-1");
if(!preserved||preserved.startedAt!==firstStartedAt)throw new Error("Recovery start time was overwritten.");

console.log("Recovery persistence test passed.");
