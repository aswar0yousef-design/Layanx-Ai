# Planned Mission Tool Execution

The runtime can now execute a tool selected and persisted by the AI planner without accepting a second client-side tool/action selection.

## Core flow

`executeMissionTool(missionId, projectId, toolIndex, payload, approvalId)`:

1. Loads the persisted mission.
2. Selects the already-approved planner tool plan by index.
3. Rebuilds the agent-scoped catalog.
4. Issues a short-lived capability scoped to the exact mission, agent, project, tool, and permission.
5. Builds the canonical `ToolRequest`.
6. Resolves the server-registered adapter.
7. Runs the existing `ExecutionRuntime`.
8. Persists the resulting mission state.

The runtime still owns permission checks, capability validation, Sentinel checks, approvals, budget, idempotency, verification, audit, ledger, and memory.

## API

`POST /v1/missions/:missionId/tools/execute`

Body:
- `projectId` — trusted execution context supplied by the caller.
- `toolIndex` — index in the persisted mission tool plan (default 0).
- `payload` — tool input.
- `approvalId` — required only when the existing risk/approval gate requires it.

The client does not supply the tool name or action. They come from the persisted mission plan.
