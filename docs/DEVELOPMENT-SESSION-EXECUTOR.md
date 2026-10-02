# Development Session Executor

Wave 15 adds an approval-aware session executor.

## Flow

1. Validate mission/project isolation.
2. Preflight every planned tool.
3. Identify dangerous or approval-required actions.
4. Validate the exact approval against mission, agent, tool, action, permission, and payload hash.
5. If any approval is missing or invalid, pause without mutating the mission.
6. If all approvals are valid, execute the planned tools through the normal runtime.
7. Finalize through the existing verification engine.

API:

`POST /v1/missions/:missionId/development-session`

Body:

- `projectId`
- optional `agentId`
- optional `approvalIds` keyed by mission tool index

A paused session returns the indexes that still require valid approvals. It does not silently bypass the approval system.
