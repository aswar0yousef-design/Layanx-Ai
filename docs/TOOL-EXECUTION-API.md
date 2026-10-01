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
