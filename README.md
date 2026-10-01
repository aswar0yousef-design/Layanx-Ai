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
