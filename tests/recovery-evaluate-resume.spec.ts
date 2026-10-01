import {ReleaseHealthProbe} from "../src/release/health-probe.js";
import {RecoveryPersistence} from "../src/release/recovery-persistence.js";
import {RecoveryAuditTrail} from "../src/release/recovery-audit.js";
import {ProductionRecoveryController} from "../src/release/recovery-controller.js";
import {RollbackController} from "../src/release/rollback.js";
import {JsonStorageAdapter} from "../src/storage/json-adapter.js";

const persistence=new RecoveryPersistence(new JsonStorageAdapter("/tmp/layanx-recovery-evaluate-resume.json"));
const deployment={version:"2.0.0",commitSha:"current-bad",manifestChecksum:"b".repeat(64),deployedAt:"2026-01-02T00:00:00Z"};
const target={version:"1.0.0",commitSha:"known-good",manifestChecksum:"a".repeat(64),deployedAt:"2026-01-01T00:00:00Z"};

await persistence.save({
 version:1,recoveryId:"evaluate-resume-test",deploymentVersion:deployment.version,
 deploymentCommitSha:deployment.commitSha,deploymentChecksum:deployment.manifestChecksum,
 state:"recovering",attempts:1,startedAt:"2026-01-02T00:00:00Z",updatedAt:"2026-01-02T00:01:00Z",
 targetVersion:target.version,targetCommitSha:target.commitSha,targetChecksum:target.manifestChecksum,
 reason:"rollback execution may already have happened"
});

let healthCalls=0;
let rollbackCalls=0;
const probe=new ReleaseHealthProbe([{name:"production",check:async()=>{healthCalls++;return true;}}]);
const executor={async execute(){rollbackCalls++;return{success:true};}};
const controller=new ProductionRecoveryController(
 probe,new RollbackController(),new RecoveryAuditTrail(),executor,
 {persistence,recoveryId:"evaluate-resume-test"}
);

const result=await controller.evaluate(deployment);
if(result.decision.action!=="keep")throw new Error("Existing recovery was not safely resumed.");
if(result.decision.target?.commitSha!==target.commitSha)throw new Error("Resumed recovery target was not preserved.");
if(result.attempts!==1)throw new Error("Resumed recovery attempt count changed.");
if(healthCalls!==1)throw new Error("Existing recovery should perform exactly one verification check.");
if(rollbackCalls!==0)throw new Error("Existing recovering state replayed the rollback side effect.");
const stored=await persistence.get("evaluate-resume-test");
if(stored?.state!=="verified")throw new Error("Resumed recovery was not persisted as verified.");

console.log("Recovery evaluate/resume idempotency passed.");
