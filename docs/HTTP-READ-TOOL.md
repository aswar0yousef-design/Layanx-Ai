# HTTP Read Tool

LayanX includes a restricted `http.read` tool for public HTTP/HTTPS GET reads.

Security boundaries:
- HTTP/HTTPS only.
- GET only.
- redirects disabled.
- localhost and common RFC1918/private IPv4 ranges blocked.
- URL length bounded.
- response size bounded.
- request timeout bounded.
- no arbitrary headers or methods are accepted from the mission payload.

The tool is `L1_READ` and remains subject to the normal Mission, Agent, Capability, Sentinel, Budget, Idempotency, Verification, Audit, and Persistence layers.

This is intentionally a read-only foundation for later connectors.
