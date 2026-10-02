# Session State & Resume

Wave 16 exposes persisted development-session state so a client can recover after a disconnect or restart.

Endpoints:

- `GET /v1/missions/:missionId/development-session?projectId=...`
- `POST /v1/missions/:missionId/development-session/resume`

The state response includes mission/execution status, recoverability, pending tool position, tool-call count, runtime, next action, checkpoint, and snapshot timestamp.

Resume still uses the existing development-session executor and therefore preserves the same exact approval requirements. A disconnect does not grant new permissions.
