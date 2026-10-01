# Result-Aware Adaptive Missions

LayanX can execute a mission adaptively instead of relying only on a fixed tool sequence.

## Execution flow

1. The mission starts with its first planned tool, when present.
2. The tool executes through the normal runtime security pipeline.
3. The tool result is bounded and passed to the AI adaptive planner.
4. The planner may select one next tool only from the server-side Tool Catalog.
5. Permission must exactly match the selected tool requirement and remain within mission scope.
6. The loop stops when the planner returns null, when a tool fails, or when the bounded step limit is reached.
7. The final result is passed to the existing verification engine without replaying the last tool.

## API

POST /v1/missions/:missionId/tools/execute-adaptive

Request example:

    {"projectId":"project-id","maxSteps":10}

The endpoint is bearer-protected when LAYANX_API_TOKEN is configured.

Adaptive execution is bounded to a maximum of 25 requested steps by the HTTP API. The runtime still enforces the agent tool-call budget, permission gates, capabilities, Sentinel, approvals, idempotency, audit and ledger controls.

## Safety properties

- The model cannot invent a tool or action.
- The model cannot elevate the tool permission.
- Tool execution always uses a server-registered adapter.
- The final tool is not replayed just to perform verification.
- A failed or blocked step stops the adaptive loop.
