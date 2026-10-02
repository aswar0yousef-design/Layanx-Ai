# Restricted Mission Tool API

The runtime API exposes a deliberately narrow execution surface:

POST /v1/missions/:missionId/tools

The endpoint does not accept executable code, shell commands, arbitrary URLs, or serialized adapters. The caller must provide an existing agent, registered tool, registered server-side adapter, mission-scoped capability token, project scope, permission, and idempotency key.

Execution passes through ExecutionRuntime, which enforces mission/agent/tool permission scopes, capability scope, risk approval, Sentinel, budget, idempotency, audit, ledger, verification, and mission persistence.

Example request body:

    {
      "agentId":"runner",
      "tool":"echo",
      "action":"read echo",
      "permission":"L1_READ",
      "projectId":"project-1",
      "capabilityId":"capability-token-id",
      "idempotencyKey":"unique-operation-key",
      "payload":{"value":42}
    }

Trusted application code registers tools and server-side adapters. API clients cannot register an adapter or bypass the registry.


## Dangerous project operations

For L4_EXECUTE tools such as terminal.exec, git.add, git.commit, and git.push, the runtime requires an explicit approval bound to the mission, agent, tool, action, permission, and exact planned payload.

1. Create an approval: `POST /v1/missions/:missionId/approvals` with `{ "projectId": "...", "toolIndex": 0 }`.
2. Approve it: `POST /v1/missions/:missionId/approvals/:approvalId/approve`.
3. Execute the planned tool with the returned `approvalId`.

Git pushes to `main` or `master` are blocked unless `LAYANX_ALLOW_MAIN_PUSH=true`.
