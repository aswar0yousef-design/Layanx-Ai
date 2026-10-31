# Repeatable local LayanX outcome acceptance (Windows 11)

Run only on a disposable Windows test environment, with a local Ollama model installed and **without production credentials**. This executes AI-generated code: it is **not an OS sandbox**. No live trading, publishing, customer messaging, or payment access is required.

## One real attempt

From the latest checked-out `main` revision:

```powershell
npm ci
npm run doctor
$env:OLLAMA_MODEL = "llama3.2:3b"
npm run acceptance:batch:local -- --runs 1
```

## Five-run reliability gate

```powershell
npm run acceptance:batch:local -- --runs 5
```

The runner executes each fresh end-to-end `acceptance:live:local` attempt in a separate subprocess. It does **not** synthesize or replay fabricated successful jobs. Each subprocess has a limited execution timeout; several runs can consume substantial CPU time on an entry-level PC.

The output includes:
- `acceptance-result.json` for each real attempt in its isolated workspace.
- `batch-*.log` per run for diagnosing model and runtime failures.
- `batch-*.json` final report under the local `outcome-runs` folder.
- Independent HTTP checks, project-run test/build machine evidence, and a separate offline `verifyDeliveryManifest` integrity check on every delivered project.

An individual run passes only when all of the following independently agree:
1. Its generated isolated project reports `completed`, `ok:true`, an existing deliverable and app files.
2. Its test/build result and independent HTTP behavior evidence are present.
3. Each of ten distinct HTTP/restart checks **and nine browser interaction checks** passed exactly once. The browser probe must click the task add/delete controls at desktop and mobile viewport sizes and verify list persistence across page reloads.
4. The offline manifest verifier confirms file sizes, SHA-256 checksums, the Outcome report and no unlisted project files.
5. The subprocess exited with code zero.

The five-run gate passes only for **five independent passing runs** with distinct jobs and workspaces, with no warnings or missing attempts. Any failed attempt fails the aggregate release decision. A single passing example is useful for diagnosis, but does **not** establish reliability.

## Important remaining constraints

This still verifies a narrow generated bilingual task-list app with real desktop/mobile browser interactions. Edge or Chrome and the optional `playwright-core` dependency must be available; browser absence is a failing release result, not a skipped success. It does **not** show that every natural-language request is reliably fulfilled, that HTML controls are usable by keyboard/screen reader, or that a browser user interaction was independently exercised. Restart testing here restarts the generated app server, not the Windows PC.

The recovery and external-action tests remain separate. No real trading or external publishing action should be switched on as a result of this score. After the batch test, inspect the workspace, generated app and reports yourself; record the Windows version, Node version, Ollama version and local model alongside the evidence.

The code records **actual measured results**, not a prediction or guarantee of 5/5 success. This command must be executed on the owner's Windows machine; GitHub CI cannot substitute for that device's runtime.
