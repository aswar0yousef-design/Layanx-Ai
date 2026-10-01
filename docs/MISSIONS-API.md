# Mission API

The Runtime API exposes the mission read path:

- `GET /v1/missions` — list missions known to the current runtime.
- `GET /v1/missions/:id` — mission, execution state, audit events, and ledger entries.

Creation remains `POST /v1/missions` and continues through the existing AI planner and permission-controlled core.

Tool execution is not exposed as an unrestricted HTTP endpoint; it must continue through the core authorization, Sentinel, and idempotency gates.
