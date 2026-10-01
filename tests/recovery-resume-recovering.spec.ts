import {ReleaseHealthProbe} from "../src/release/health-probe.js";
import {RecoveryPersistence} from "../src/release/recovery-persistence.js";
import {RecoveryAuditTrail} from "../src/release/recovery-audit.js";
import {ProductionRecoveryController} from "../src/release/recovery-controller.js";
import {RollbackController} from "../src/release/rollback.js";
import {InMemoryRollbackExecutor} from "../src/release/rollback-executor.js";
import {JsonStorageAdapter} from "../src/storage/json-adapter.js";

const persistence=new RecoveryPersistence(new JsonStorageAdapter("/tmp/layanx-resume-recovering.json"));
const deployment={version:"2.0.0",commitSha:"failed",manifestChecksum:"b".repeat(64),deployedAt:"2026-01-02T00:00:00Z"};
const target={version:"1.0.0",commitSha:"known-good",manifestChecksum:"a".repeat(64),deployedAt:"2026-01-01T00:00:00Z"};

await persistence.save({version:1,recoveryId:"recovering-test",deploymentVersion:deployment.version,deploymentCommitSha:deployment.commitSha,deploymentChecksum:deployment.manifestChecksum,state:"recovering",attempts:1,startedAt:"2026-01-02T00:00:00Z",updatedAt:"2026-01-02T00:01:00Z",targetVersion:target.version,targetCommitSha:target.commitSha,targetChecksum:target.manifestChecksum});

let calls=0;
const probe=new ReleaseHealthProbe([{name:"production",check:async()=>{calls++;return false;}}]);
const executor=new InMemoryRollbackExecutor();
const controller=new ProductionRecoveryController(probe,new RollbackController(),new RecoveryAuditTrail(),executor,{persistence,recoveryId:"recovering-test"});
const result=await controller.resumeActiveRecovery(deployment);

if(result.decision.action!=="halt")throw new Error("Unsafe recovering state was not halted.");
if(result.attempts!==1)throw new Error("Resume changed the attempt count.");
if(calls!==1)throw new Error("Resume should perform exactly one health verification.");
const stored=await persistence.get("recovering-test");
if(stored?.state!=="halted")throw new Error("Unsafe recovery state was not persisted as halted.");

console.log("Unsafe recovering resume protection passed.");
