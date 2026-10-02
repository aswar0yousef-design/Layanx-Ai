# LayanX AI

LayanX is a security-first autonomous AI runtime foundation designed **currently as a local-first, single-device system**.

The present target is to run the full runtime on the user's own computer with local storage and local AI providers such as Ollama. Multi-tenant SaaS, remote hosting, and cloud deployment are future evolution paths, not current runtime requirements.

## Current architecture

- Mission planning and execution
- Risk, permission, approval, and capability enforcement
- Tool registry and guarded execution
- Verification, audit ledger, checkpoints, and recovery
- Model/provider routing and failover foundations
- Executable local Ollama and OpenAI-compatible model adapters
- Health-gated provider failover with bounded request timeouts
- Project isolation and memory boundaries
- Skill scanning and controlled enablement
- Storage abstraction and migrations foundation
- Tool Fabric: Browser, Files, and Terminal
- MCP Gateway
- Skills Runtime
- Project-scoped Memory/Context Fabric
- Bounded Agent Teams and repair
- LayanX Control Center

## Scheduler and event-driven missions

LayanX now includes an in-process Scheduler and Event Mission Engine:

- One-time and interval mission schedules.
- Bounded scheduler tick loop with duplicate-run protection.
- Event triggers scoped by project.
- Optional exact payload matching for event triggers.
- Scheduled/event missions enter the same Agent Gateway and therefore retain permissions, risk controls, approvals, verification, recovery, audit, and memory.
- API endpoints expose schedule/trigger registration and manual event emission.
- Scheduler state is currently process-local; durable scheduling belongs to the later PostgreSQL/operations phase.

## Dependency-aware task runtime

Task decomposition is now executable through a dependency-aware runtime:

- Independent tasks can run in parallel with a bounded concurrency limit.
- A task starts only after all declared dependencies complete successfully.
- Dependency results are passed into downstream task context as untrusted data.
- Failed or blocked dependencies prevent downstream execution.
- Task assignments preserve the selected agent and model metadata.
- Model routing is applied to the mission planner only when the selected model also supports reasoning; otherwise the planner selects a compatible reasoning model using the task/agent tags.
- Execution still passes through the existing mission gateway, permissions, risk controls, approvals, verification, recovery, audit, and memory.

Programmatic entry point:

`LayanXCore.executeTaskDecomposition(goal, projectId, maxConcurrency, projectContext)`

## Voice interface

LayanX now includes a voice layer on top of the existing Runtime. It provides microphone-friendly local UI at `/voice`, speech-to-text at `/v1/voice/transcribe`, text-to-speech at `/v1/voice/speak`, and voice provider status at `/v1/voice/status`. Voice commands are sent through the existing `/v1/agent/gateway`, so planning, permissions, tools, verification, recovery, memory, and audit remain in the same runtime path.

The first voice adapter uses OpenAI audio endpoints when `OPENAI_API_KEY` is configured. The adapter is isolated behind `VoiceService`, so a local STT/TTS provider can be added later without changing the mission engine. Realtime voice is available through WebRTC using short-lived ephemeral client secrets; the browser never receives the long-lived API key. Realtime function calling exposes `layanx_execute`, which routes project/system actions back into the existing LayanX Agent Gateway. Current OpenAI documentation also exposes dedicated transcription and real-time audio capabilities.

Open the local voice UI after starting the API:

```text
http://127.0.0.1:3000/voice
```

## Local runtime

Install dependencies:

```bash
npm install
```

Run the local runtime:

```bash
npm run layanx
```

Run the local API:

```bash
npm run api
```

Inspect local runtime state:

```bash
npm run doctor
npm run layanx -- check
npm run layanx -- health
```

### Local persistence

- `LAYANX_RUNTIME_STORAGE_PATH` enables durable JSON storage for local/self-hosted use.
- `LAYANX_DATABASE_URL` or `DATABASE_URL` can later select PostgreSQL without changing mission/business logic.
- PostgreSQL is an optional persistence backend; it is not required for the current local-first target.
- Runtime snapshots remain validated by `RuntimePersistence` before commit.

### Local AI

Ollama is the default local provider path when enabled. The default model is configured by the provider configuration and can be changed through environment variables.

No production cloud deployment is required to use the current system.

## Quality gates

```bash
npm run typecheck
npm run security:check
npm test
npm run release:check
npm run build
```

## Future evolution

The architecture keeps project boundaries, storage abstraction, provider routing, tool isolation, and API boundaries explicit so the local runtime can later evolve into a multi-tenant platform.

That future migration should add tenant identity, tenant-scoped storage, authentication/authorization, quotas, billing, remote workers, and operational isolation **without changing the security contracts of the local mission engine**.

## Development principle

Stabilize and verify the existing local foundation before adding another architectural layer. Production or SaaS claims must be backed by executable evidence.

### Automatic Test Verification

LayanX can automatically execute the tests selected by Change Impact Analysis after L3+ modifications. The test runner is workspace-confined, uses the local project `tsx` executable without a shell, enforces time/output limits, and records test results in Audit and Memory. When selected tests fail, the Agent Loop passes the failure back to the bounded Autonomous Repair Loop and retests after each repair attempt (up to 3 attempts).

## Mission dependencies, autonomous retry, and failure learning

Mission dependencies are distinct from task dependencies. A mission may depend on other missions in the same project; dependency cycles and cross-project dependencies are rejected. A downstream mission remains pending until all dependencies complete and becomes blocked when a dependency fails.

API:
- `GET /v1/mission-dependencies?projectId=...`
- `POST /v1/mission-dependencies` with `missionId`, `projectId`, and `dependsOn`
- `GET /v1/mission-dependencies/:missionId`
- `POST /v1/mission-dependencies/:missionId/run`

Autonomous retry is bounded and conservative. Only recoverable transient failures on L1/L2 read/analyze operations are retried automatically. Permission, approval, scope, verification, and modification/execution failures are not automatically retried. Each retry receives a distinct idempotency key and uses bounded exponential backoff.

Failure learning normalizes runtime failures into categories and stores sanitized failure signatures in the existing project-scoped memory engine. Similar failures can be recalled for future planning without introducing another memory subsystem.

## Repository intelligence and safe code modification

Repository intelligence provides bounded project/file metadata and a dependency graph used by impact analysis and automatic test selection.

Safe code modification is transactional:
1. validate project-relative paths and protected directories
2. rebuild project graph and change impact
3. select affected tests
4. require explicit approval for high/critical impact
5. create a local backup
6. apply all requested files
7. run selected tests
8. rollback all changes if verification fails

Git branch isolation is available through the runtime branch manager. Autonomous branch creation and switching require a clean working tree by default and reject unsafe Git branch names.

Git APIs:
- `GET /v1/git/branch`
- `POST /v1/git/branch` with `branchName`, optional `baseRef`, and optional `requireClean`

## Autonomous commit and code review

After safe code modification, LayanX can inspect the Git working tree and create a scoped commit. The commit layer verifies the expected branch, rejects unexpected files when a scope is supplied, stages only the selected files, and rejects unsafe autonomous commit messages.

Code review is available before promotion:
- `POST /v1/git/review`
- detects potential credentials/private keys
- flags `eval()` and shell execution patterns
- reports changed files and missing test-file changes
- returns an approval signal without automatically merging or releasing code

Git commit:
- `POST /v1/git/commit` with `missionId`, `projectId`, `message`, optional `expectedBranch` and `paths`

## Security review gate

LayanX now has a deterministic security review layer:
- `POST /v1/git/security-review`
- scans the committed diff for credential/private-key exposure
- flags dynamic code execution and shell execution
- checks traversal patterns and sensitive configuration files
- flags plain HTTP and credential-handling patterns for review
- reports dependency manifest/lockfile changes
- returns `approved=false` for high/critical findings

Security review is intentionally separate from ordinary code review so a future PR generator can require both gates independently.
