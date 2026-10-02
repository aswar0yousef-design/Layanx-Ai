# Mission Event Stream

Wave 20 adds a bounded live execution view derived from the existing sanitized audit log.

## Control-center API

GET /v1/control-center?projectId=<projectId> now includes `events`.

Each mission also includes its own `events` array. Events contain only execution metadata such as mission/project identifiers, action, tool, step index, status-derived type, and sanitized error/reason text.

The stream is:
- project scoped;
- bounded to 200 events per mission;
- deterministic for repeated polling;
- derived from the audit log, so it survives runtime snapshot restoration when audit data is restored;
- intentionally free of raw tool payloads, credentials, bearer tokens, and secrets.

## Polling

Clients can poll the existing control-center endpoint and retain the last event id. The event model supports an `after` cursor internally; a dedicated SSE endpoint can be added later without changing the event contract.

## Security

Project filtering is applied before events are returned. The underlying audit sanitizer redacts sensitive keys and bearer tokens.
