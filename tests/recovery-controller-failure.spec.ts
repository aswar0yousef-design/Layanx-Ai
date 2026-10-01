import {ReleaseHealthProbe} from "../src/release/health-probe.js";
import {RecoveryAuditTrail} from "../src/release/recovery-audit.js";
import {RollbackController} from "../src/release/rollback.js";
import {ProductionRecoveryController} from "../src/release/recovery-controller.js";
import {RecoveryPersistence} from "../src/release/recovery-persistence.js";
import {JsonStorageAdapter} from "../src/storage/json-adapter.js";

const rollback=new RollbackController();
const previous={
 version:"1.0.0",
 commitSha:"good1234",
 manifestChecksum:"a".repeat(64),
 deployedAt:"2026-01-01T00:00:00Z"
};
const current={
 version:"1.1.0",
 commitSha:"bad1234",
 manifestChecksum:"b".repeat(64),
 deployedAt:"2026-01-02T00:00:00Z"
};
rollback.record(previous);

const probe=new ReleaseHealthProbe([{name:"api",check:async()=>false}]);
const executor={
 async execute(target:typeof previous){
  return{success:false,reason:"Rollback provider unavailable."};
 }
};
const persistence=new RecoveryPersistence(new JsonStorageAdapter("/tmp/layanx-controller-failure.json"));
const controller=new ProductionRecoveryController(
 probe,
 rollback,
 new RecoveryAuditTrail(),
 executor,
 {maxAttempts:1,persistence,recoveryId:"recovery-controller-failure-test"}
);

const result=await controller.evaluate(current);
if(result.decision.action!=="halt")throw new Error("Failed rollback execution did not halt recovery.");
const active=await controller.inspectActiveRecovery();
if(active!==undefined)throw new Error("Terminal halted recovery remained active.");
const history=await controller.history();
const record=history.find(item=>item.recoveryId==="recovery-controller-failure-test");
if(!record||record.state!=="halted")throw new Error("Rollback execution failure was not persisted as halted.");
if(record.attempts!==1)throw new Error("Halted recovery attempt count is incorrect.");

console.log("Rollback execution failure persistence test passed.");
