import {ReleaseHealthProbe} from "../src/release/health-probe.js";
import {RecoveryPersistence} from "../src/release/recovery-persistence.js";
import {RecoveryAuditTrail} from "../src/release/recovery-audit.js";
import {ProductionRecoveryController} from "../src/release/recovery-controller.js";
import {RollbackController} from "../src/release/rollback.js";
import {InMemoryRollbackExecutor} from "../src/release/rollback-executor.js";
import {JsonStorageAdapter} from "../src/storage/json-adapter.js";

const path="/tmp/layanx-resume-recovery.json";
const persistence=new RecoveryPersistence(new JsonStorageAdapter(path));
const target={version:"1.0.0",commitSha:"known-good",manifestChecksum:"a".repeat(64),deployedAt:"2026-01-01T00:00:00Z"};
const failed={version:"2.0.0",commitSha:"failed",manifestChecksum:"b".repeat(64),deployedAt:"2026-01-02T00:00:00Z"};

await persistence.save({
 version:1,recoveryId:"resume-test",deploymentVersion:failed.version,deploymentCommitSha:failed.commitSha,
 deploymentChecksum:failed.manifestChecksum,state:"rolled_back",attempts:1,startedAt:"2026-01-02T00:00:00Z",
 updatedAt:"2026-01-02T00:01:00Z",targetVersion:target.version,targetCommitSha:target.commitSha,targetChecksum:target.manifestChecksum
});

const probe=new ReleaseHealthProbe([{name:"production",check:async()=>true}]);
const controller=new ProductionRecoveryController(probe,new RollbackController(),new RecoveryAuditTrail(),new InMemoryRollbackExecutor(),{persistence,recoveryId:"resume-test"});
const result=await controller.resumeActiveRecovery(failed);
if(result.decision.action!=="keep"||result.decision.target?.commitSha!=="known-good")throw new Error("Persisted recovery did not resume to the verified target.");
if(result.attempts!==1)throw new Error("Resume changed the persisted attempt count.");
const stored=await persistence.get("resume-test");
if(stored?.state!=="verified")throw new Error("Resumed recovery was not persisted as verified.");

console.log("Safe recovery resume passed.");
