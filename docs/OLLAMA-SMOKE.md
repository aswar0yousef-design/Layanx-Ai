# Local Ollama smoke test

This is a manual machine-level test. It is intentionally not part of npm test or GitHub CI because CI must not depend on a developer's local Ollama service.

## Prerequisites
1. Install and start Ollama.
2. Pull the configured model, for example: ollama pull llama3.2:3b
3. Verify the service is reachable on http://127.0.0.1:11434.

## Run
npm install
npm run smoke:ollama

Optional configuration:
OLLAMA_BASE_URL=http://127.0.0.1:11434 OLLAMA_MODEL=llama3.2:3b LAYANX_AI_MODE=local npm run smoke:ollama

The test performs two real operations:
1. Calls Ollama's health/tags endpoint.
2. Sends a real reasoning request through LayanX's ModelExecutionRouter.

A successful result proves that the local Ollama adapter, runtime configuration, provider health, model registry, and model execution path can communicate with a real Ollama instance.

Exit code 2 means Ollama is unavailable. Other failures indicate an integration problem.


## Full runtime E2E

After the smoke test passes, run:

```bash
npm run e2e:ollama
```

This manual machine-level check exercises the real Ollama provider through the LayanX AI planner, mission/agent loop, runtime tool execution, verification, JSON persistence, and a fresh runtime restart. It is intentionally excluded from GitHub CI because it requires a local Ollama service and model.
