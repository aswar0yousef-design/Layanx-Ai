import {RollbackController} from "../src/release/rollback.js";

const rollback=new RollbackController();
const knownGood={version:"1.0.0",commitSha:"known-good",manifestChecksum:"a".repeat(64),deployedAt:"2026-01-01T00:00:00Z"};
const failed={version:"2.0.0",commitSha:"failed",manifestChecksum:"b".repeat(64),deployedAt:"2026-01-02T00:00:00Z"};

rollback.record(knownGood);
rollback.record(failed);
rollback.record(failed);

const decision=rollback.decide({healthy:false,reason:"deployment unhealthy"});
if(decision.action!=="rollback")throw new Error("Unhealthy deployment did not request rollback.");
if(decision.target?.commitSha!=="known-good")throw new Error("Rollback selected a duplicate failed deployment instead of the known-good deployment.");
console.log("Known-good deployment deduplication passed.");
