# LayanX Release Gate

A production release must have evidence for typecheck, tests, red-team checks, configuration validation, and recovery readiness.

The release is bound to a version, Git commit SHA, and SHA-256 manifest checksum.

## CI quality gate

Every push and pull request to `main` runs:

1. Secret/security check
2. TypeScript typecheck
3. Test suite

The same sequence is available locally with:

```bash
npm run release:check
```

## Deployment safety

After deployment, ReleaseHealthProbe runs configured health checks. If the new deployment is unhealthy, RollbackController selects the previous known-good deployment.

Flow:

Development -> Staging -> CI Quality Gate -> Release Gate -> Production -> Health Probe -> Keep / Rollback

Rollback is deliberately separated from application business logic so deployment recovery remains independently auditable.
