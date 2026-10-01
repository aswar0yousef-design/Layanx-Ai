import {ReleaseHealthProbe} from "../src/release/health-probe.js";
import {RecoveryAuditTrail} from "../src/release/recovery-audit.js";
import {ProductionRecoveryController} from "../src/release/recovery-controller.js";
import {RecoveryPersistence} from "../src/release/recovery-persistence.js";
import {RollbackController} from "../src/release/rollback.js";
import {JsonStorageAdapter} from "../src/storage/json-adapter.js";

const path="/tmp/layanx-recovery-crash-boundary.json";
const base=new RecoveryPersistence(new JsonStorageAdapter(path));
const deployment={version:"2.0.0",commitSha:"current-bad",manifestChecksum:"b".repeat(64),deployedAt:"2026-01-02T00:00:00Z"};
const target={version:"1.0.0",commitSha:"known-good",manifestChecksum:"a".repeat(64),deployedAt:"2026-01-01T00:00:00Z"};

const rollback=new RollbackController();
rollback.record(target);

let rollbackCalls=0;
const executor={
 async execute(){rollbackCalls++;return{success:true,deployment:{...target}};}
};

let rolledBackPersistAttempts=0;
const crashingPersistence={
 findActive:()=>base.findActive(),
 get:(id:string)=>base.get(id),
 history:(limit?:number)=>base.history(limit),
 save:async(record:Parameters<RecoveryPersistence["save"]>[0])=>{
  if(record.state==="rolled_back"&&rolledBackPersistAttempts++===0)
   throw new Error("simulated process crash before rolled_back persistence");
  return base.save(record);
 },
 clear:(id:string)=>base.clear(id)
} as RecoveryPersistence;

const firstProbe=new ReleaseHealthProbe([{name:"production",check:async()=>false}]);
const firstController=new ProductionRecoveryController(
 firstProbe,rollback,new RecoveryAuditTrail(),executor,
 {maxAttempts:1,persistence:crashingPersistence,recoveryId:"crash-boundary"}
);

let crashed=false;
try{
 await firstController.evaluate(deployment);
}catch(error){
 crashed=error instanceof Error&&error.message.includes("simulated process crash");
}
if(!crashed)throw new Error("Crash boundary was not simulated.");
if(rollbackCalls!==1)throw new Error("Rollback side effect did not execute exactly once before the simulated crash.");

const persisted=await base.get("crash-boundary");
if(persisted?.state!=="recovering")throw new Error("Interrupted rollback was not left in recovering state.");
if(persisted.attempts!==1)throw new Error("Interrupted rollback attempt count was not preserved.");

let resumeHealthCalls=0;
const resumeProbe=new ReleaseHealthProbe([{name:"production",check:async()=>{resumeHealthCalls++;return true;}}]);
const resumedController=new ProductionRecoveryController(
 resumeProbe,rollback,new RecoveryAuditTrail(),executor,
 {maxAttempts:1,persistence:base,recoveryId:"crash-boundary"}
);
const resumed=await resumedController.resumeActiveRecovery(deployment);

if(resumed.decision.action!=="keep")throw new Error("Interrupted recovery did not resume safely.");
if(resumed.decision.target?.commitSha!==target.commitSha)throw new Error("Recovery target was not preserved after restart.");
if(resumeHealthCalls!==1)throw new Error("Restart should perform exactly one verification check.");
if(rollbackCalls!==1)throw new Error("Restart replayed the rollback side effect.");

const final=await base.get("crash-boundary");
if(final?.state!=="verified")throw new Error("Recovered crash-boundary state was not finalized as verified.");

console.log("Recovery crash-boundary resume without duplicate side effect passed.");
