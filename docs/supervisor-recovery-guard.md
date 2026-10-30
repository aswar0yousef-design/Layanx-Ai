# Supervisor recovery hold after interrupted execution

The Supervisor must not automatically replay a previously running milestone after a process crash or Windows restart. The earlier attempt might have written a file, sent an email, published content, created an order, or placed a trade without returning its result.

## Automatic recovery policy

- Planning and queued work with no in-flight milestone may continue normally.
- Persisted, complete approval requests remain paused until the original approval is decided.
- A previously **running** milestone, or an approval without its persisted request metadata, is placed into a **failed / recovery hold** state.
- The stored job contains `recoveryHold.kind`, `at`, `milestone` and `description`. Normal `resume` returns `recovery_reconciliation_required`.
- Both the hold and the decision are persisted and visible in the dashboard.
- The Dashboard shows **Reviewed effects: retry** and **Stop without retry**, both requiring explicit owner confirmation.

## Before choosing retry

1. Inspect the job's last log messages and the runtime mission/audit log.
2. Inspect external systems involved in the interrupted step: email outbox, social-platform posts, e-commerce orders, carrier bookings, MT5 trade history, or any other applicable operation.
3. If the external result can be confirmed, reconcile it in the relevant system. If unsure whether an action already occurred, prefer **stop without retry** over duplicating it.
4. Only use **retry** after confirming that replaying this step is safe. It may execute the same action again; this is *not* an exactly-once guarantee.

## Local API

Requires an authenticated LayanX token. Retrieve job details with `GET /v1/supervisor/jobs/{jobId}`.

To stop without replay:

```http
POST /v1/supervisor/jobs/{jobId}/reconcile
Content-Type: application/json

{"decision":"abort","acknowledgeUnknownEffects":true}
```

To explicitly permit a retry after review:

```http
POST /v1/supervisor/jobs/{jobId}/reconcile
Content-Type: application/json

{"decision":"retry","acknowledgeUnknownEffects":true}
```

This endpoint does **not** infer a transaction receipt from a model response. Missing acknowledgment, unknown decisions and normal resume while the hold exists are rejected. An aborted hold remains blocked from normal resume.

## Limits / pending acceptance

- A recovery hold is a safety mechanism, not automatic reconciliation or rollback.
- This change does not guarantee exactly-once effects for every external connector. Each connector still needs idempotency keys and an authoritative read-before-retry check.
- CI simulates persisted in-flight state and restarts. Real Windows 11 + Ollama crash/restart tests and remote-service reconciliation remain tracked in issue #178.
