# LayanX AI

LayanX is a security-first autonomous AI runtime foundation.

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
- Environment profiles and release gates
- Post-deployment health probes and rollback logic

## Quality commands

```bash
npm install
npm run typecheck
npm run security:check
npm test
npm run release:check
```

The repository intentionally separates core business logic from storage and deployment concerns so the persistence backend and hosting platform can evolve without rewriting the mission engine.

## Runtime persistence

- `LAYANX_DATABASE_URL` (or `DATABASE_URL`) enables the PostgreSQL runtime store.
- `LAYANX_RUNTIME_STORAGE_PATH` enables durable JSON storage for local/self-hosted deployments when PostgreSQL is not configured.
- PostgreSQL is preferred when both are configured.
- Runtime snapshots remain validated by `RuntimePersistence` before they are committed.

## Development principle

Stabilize and verify the existing foundation before adding another architectural layer. Production claims should be backed by executable CI evidence.
