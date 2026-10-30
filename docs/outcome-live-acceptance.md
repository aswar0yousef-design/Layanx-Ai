# LayanX Outcome Engine — real local acceptance (Windows 11)

This test runs against your **installed Ollama model and the real LayanX runtime**.
It is different from the deterministic CI integration test, which uses a fake planner/agent.

## Run in PowerShell

From the LayanX-AI repo root (after pulling the release with this script):

```powershell
npm ci
npm run doctor
npm run acceptance:live:local
```

Ollama must be running and the configured `OLLAMA_MODEL` must be installed.
You may select a local model in PowerShell before running:

```powershell
$env:OLLAMA_MODEL = "llama3.2:3b"
npm run acceptance:live:local
```

## What this proves

- An actual local model plans a goal and the LayanX coder attempts to generate a brand-new Node.js task API.
- The real `project.run` adapter executes install, test and build steps.
- The output file `acceptance-result.json` records the final status, test references, blockers and workspace path.
- `ok: true` requires a completed Supervisor job, a verified Outcome report, successful non-skipped test **and** build evidence, and the requested project files.
- If approval is required or any check fails, the run reports `ok: false` (never a fabricated pass).

## Isolation and limitations

Each run creates its own workspace under `%LOCALAPPDATA%\\LayanX\\outcome-runs` (or the platform data directory).
The script sets local-only AI, enables the coding capability only, disables browser auto-open and MT5 auto-start, and assigns *trusted* permission **only** to the disposable project.
`no-scripts` prevents npm package lifecycle scripts; it is not a full OS sandbox.
The local agent can still execute coding tools. Review the run on a non-sensitive test machine and do not use this command with production credentials.
No external accounts are intentionally used.

Passing this test demonstrates **one specific app-delivery workflow on this machine**.
It does not validate every desktop operation, every business connector, or real trading.
The output workspace and reports are retained for inspection.
