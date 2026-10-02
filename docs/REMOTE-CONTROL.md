# Remote Control API

The mobile control surface is intentionally a control-plane API, not direct system access.

## Session overview

`GET /v1/control-center/session?projectId=<id>`

Optional `missionId` limits the response to one mission.

The response exposes project-scoped mission status and persisted development-session state.

Mutating actions continue through the existing authenticated endpoints:
- development session execution
- approval creation
- approval
- session resume
- mission cancellation

No mobile endpoint bypasses project isolation, capability checks, approval validation, audit, or runtime persistence.
