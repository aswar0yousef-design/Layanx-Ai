# LayanX Release Gate

A production release must have evidence for security checks, typecheck, tests, red-team checks, configuration validation, and recovery readiness. The release evidence must also contain a valid Git commit SHA and a 64-character SHA-256 manifest checksum.

The release is bound to a version, Git commit SHA, and SHA-256 manifest checksum.

## CI quality gate

Every push and pull request to `main` runs:

1. Secret/security check
2. TypeScript typecheck
3. Test suite

The Release Gate separately refuses release evidence when security, recovery, or release identity/checksum evidence is missing or malformed.

The same sequence is available locally with:

```bash
npm run release:check
```

## Deployment safety

After deployment, ReleaseHealthProbe runs configured health checks. If the new deployment is unhealthy, RollbackController selects the previous known-good deployment. A rollback is not considered recovered until the target deployment passes a second post-recovery health verification. If that verification fails, recovery halts instead of looping automatically.

Flow:

Development -> Staging -> CI Quality Gate -> Release Gate -> Production -> Health Probe -> Keep / Rollback

Rollback is deliberately separated from application business logic so deployment recovery remains independently auditable. RecoveryAuditTrail records recovery start, rollback target, post-recovery verification, or a halted recovery with version/commit/checksum evidence and a final summary. RecoveryStateMachine constrains the lifecycle to valid transitions and prevents recovery from continuing after verification or halt. RecoveryPersistence stores the recovery identifier, deployment identity, target deployment, state, attempt count, timestamps, and reason so a process restart can inspect the last recovery position before starting another recovery. RecoveryResumeEngine maps an interrupted state to a safe next action: checking, verification, completion, or halt; an interrupted `recovering` state is verified before another rollback is considered. RecoveryPersistence keeps terminal recovery records in a bounded queryable history while retaining only one active recovery record, and the controller exposes that history for an administrative recovery view.
