# Built-in Safe Tools

LayanX ships with bounded project execution tools registered by the runtime.

## Read-only built-ins

- runtime.status — returns sanitized runtime readiness, providers, models, agents, and registered tool metadata.
- mission.inspect — returns the current mission's goal, state, risk, permission, and step statuses.
- memory.recall — searches the internal sanitized memory index with a bounded result limit.

All three require L1_READ, are non-dangerous, and execute through the same ExecutionRuntime security pipeline as external tools. They do not expose shell execution, arbitrary filesystem access, credentials, network requests, or adapter registration to callers.

A capability must explicitly authorize the tool for the mission, agent, project, and permission before execution.

## Project execution tools

- files.read / files.list / files.stat — inspect files inside a project workspace.
- files.write — L3_MODIFY file replacement, limited to the project workspace and bounded to 2 MiB per write.
- terminal.exec — L4_EXECUTE, restricted to an explicit allowlist (git status/diff/log and npm test/typecheck/build) with shell metacharacters blocked.
- git.status / git.diff / git.log — L2_ANALYZE Git inspection.
- git.add / git.commit / git.push — L4_EXECUTE dangerous operations. They require explicit mission approval; pushes to main/master are disabled unless LAYANX_ALLOW_MAIN_PUSH=true.

Dangerous project operations are still subject to capability scope, permission ceilings, Sentinel, budget, idempotency, audit, ledger, verification, and project isolation. Approval can be requested and approved through the mission approval API.
