# Production Agent Gateway

`POST /v1/agent/gateway` is the unified control-plane entry point for a mission.

It plans a mission, starts its runtime state, and runs the bounded agent loop. It accepts `goal`, `projectId`, optional `agentId`, `maxSteps` (1-25), and optional approval IDs keyed by tool-plan index.

A response with `202` means the agent paused for approval. Existing permission, capability, risk, approval, budget, sentinel, audit, persistence, and verification controls remain in force.

This endpoint is an application gateway; it does not by itself claim public cloud deployment or internet exposure.
