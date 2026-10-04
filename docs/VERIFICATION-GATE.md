# Verification Gate

LayanX quality validation must execute the complete top-level test suite rather than passing a glob to tsx.

## Required gates

1. `npm run security:check`
2. `npm run typecheck`
3. `npm run test:all`
4. `npm run build`

`npm test` and `npm run test:unit` both use the same explicit full-test runner.

The runner discovers every `tests/*.spec.ts`, executes each file with the local `tsx` executable and `shell:false`, reports pass/fail counts, and exits non-zero when any discovered test fails.

## Local API security

When `LAYANX_API_TOKEN` is configured, requests require `Authorization: Bearer <token>`. When no token is configured, the API remains loopback-only and rejects untrusted browser Origins. JSON POST routes require `Content-Type: application/json` unless the route is an explicitly non-JSON endpoint or public webhook.

Remote API binding requires a token.

## Trading

Live trading remains behind explicit MT5 live-trading and auto-scalping flags plus execution permission/risk controls. Paper-trading limits are separate from live MT5 risk policy.

## Release rule

The full test count and every quality gate are authoritative; a partial or stale CI run must never be treated as a release signal.
