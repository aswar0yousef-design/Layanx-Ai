import {RecoveryAuditTrail} from "../src/release/recovery-audit.js";

const trail=new RecoveryAuditTrail();
const resource="deployment:1.1.0";

trail.record({
 timestamp:"2026-01-02T00:00:00Z",
 actor:"release-controller",
 action:"recovery.started",
 resource,
 result:"started",
 metadata:{reason:"health check failed",fromVersion:"1.1.0",fromCommitSha:"bad",fromChecksum:"bad"}
});
trail.record({
 timestamp:"2026-01-02T00:01:00Z",
 actor:"release-controller",
 action:"recovery.rollback",
 resource,
 result:"rolled_back",
 metadata:{toVersion:"1.0.0",toCommitSha:"good",toChecksum:"good"}
});
trail.record({
 timestamp:"2026-01-02T00:02:00Z",
 actor:"release-controller",
 action:"recovery.verified",
 resource,
 result:"verified",
 metadata:{verificationReason:"all health checks passed"}
});

const summary=trail.summarize(resource);
if(!summary.started||!summary.rollback||!summary.verified||!summary.complete)
 throw new Error("Completed recovery audit trail was not summarized correctly.");

const listed=trail.list(resource);
if(listed.length!==3)throw new Error("Recovery audit events were not retained.");

const haltedResource="deployment:2.0.0";
trail.record({
 timestamp:"2026-01-03T00:00:00Z",
 actor:"release-controller",
 action:"recovery.halted",
 resource:haltedResource,
 result:"halted",
 metadata:{reason:"rollback verification failed"}
});
const halted=trail.summarize(haltedResource);
if(!halted.halted||halted.complete)throw new Error("Halted recovery was incorrectly marked complete.");

console.log("Recovery audit test passed.");
