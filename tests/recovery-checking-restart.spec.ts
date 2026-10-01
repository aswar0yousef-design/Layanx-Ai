import {ReleaseHealthProbe} from "../src/release/health-probe.js";
import {RecoveryAuditTrail} from "../src/release/recovery-audit.js";
import {ProductionRecoveryController} from "../src/release/recovery-controller.js";
import {RecoveryPersistence} from "../src/release/recovery-persistence.js";
import {RollbackController} from "../src/release/rollback.js";
import {InMemoryRollbackExecutor} from "../src/release/rollback-executor.js";
import {JsonStorageAdapter} from "../src/storage/json-adapter.js";

const deployment={version:"2.0.0",commitSha:"current",manifestChecksum:"c".repeat(64),deployedAt:"2026-01-03T00:00:00Z"};
const persistence=new RecoveryPersistence(new JsonStorageAdapter("/tmp/layanx-checking-restart.json"));
await persistence.save({
 version:1,recoveryId:"checking-restart",deploymentVersion:deployment.version,deploymentCommitSha:deployment.commitSha,
 deploymentChecksum:deployment.manifestChecksum,state:"checking",attempts:0,startedAt:"2026-01-03T00:00:00Z",
 updatedAt:"2026-01-03T00:01:00Z",reason:"Previous health check was interrupted."
});

const controller=new ProductionRecoveryController(
 new ReleaseHealthProbe([{name:"api",check:async()=>true}]),
 new RollbackController(),
 new RecoveryAuditTrail(),
 new InMemoryRollbackExecutor(),
 {persistence,recoveryId:"checking-restart"}
);

const result=await controller.resumeActiveRecovery(deployment);
if(result.decision.action!=="keep"||result.decision.target?.commitSha!==deployment.commitSha)
 throw new Error("Healthy deployment after interrupted checking was not kept.");
if(result.attempts!==0)throw new Error("Checking restart unexpectedly changed attempts.");
const stored=await persistence.get("checking-restart");
if(stored?.state!=="verified")throw new Error("Healthy checking restart was not persisted as verified.");

console.log("Recovery checking restart test passed.");
