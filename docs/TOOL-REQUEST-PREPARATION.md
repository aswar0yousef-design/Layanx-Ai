# Tool Request Preparation

A planned mission tool can now be converted into a canonical `ToolRequest` without letting the model or client invent execution scope.

## Flow

1. The AI planner selects a tool/action from the agent-scoped Tool Catalog.
2. The Mission Compiler persists the selection on the mission.
3. `prepareMissionToolRequests()` validates the plan again against the catalog and mission permission.
4. LayanX issues a short-lived capability token scoped to the exact mission, agent, project, tool, and permission.
5. A deterministic idempotency key is generated from mission + agent + tool + action.
6. The resulting request is ready for the existing `ExecutionRuntime`.

Preparation does **not** execute the tool.

## API

`GET /v1/missions/:missionId/tools/prepare`

Requires the normal API bearer token when configured and an `x-layanx-project-id` header.

The response contains the prepared request plus its capability identifier and expiration. The capability remains subject to the normal runtime permission, Sentinel, approval, budget, idempotency, and verification gates.

Unknown tools, unsupported actions, or permissions outside the mission scope are rejected.
