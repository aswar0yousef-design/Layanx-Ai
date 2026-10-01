# GitHub Read Connector

LayanX provides three read-only GitHub tools:

- `github.repo.read` — repository metadata.
- `github.issues.list` — open issues.
- `github.prs.list` — open pull requests.

All operations are HTTP GET requests to the GitHub API. The repository argument must use `owner/repository` format and the connector does not expose arbitrary URLs, methods, or headers to the model.

Authentication is optional for public repositories. When `GITHUB_TOKEN` is configured, the runtime sends it as a Bearer credential. The token is supplied by the runtime environment and is never part of a MissionToolPlan or ToolRequest payload.

The tools are L1 read operations and remain behind LayanX Agent, Mission, Capability, Sentinel, Budget, Idempotency, Verification, Audit, and Persistence controls.
