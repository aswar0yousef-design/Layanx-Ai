# LayanX Release Gate

A production release must have evidence for typecheck, tests, red-team checks, configuration validation, and recovery readiness.

The release is bound to a version, Git commit SHA, and SHA-256 manifest checksum.

## Deployment safety

After deployment, ReleaseHealthProbe runs configured health checks. If the new deployment is unhealthy, RollbackController selects the previous known-good deployment.

Flow:

Development -> Staging -> Release Gate -> Production -> Health Probe -> Keep / Rollback

Rollback is deliberately separated from application business logic so deployment recovery remains independently auditable.
