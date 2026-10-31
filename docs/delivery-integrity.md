# Verify a delivered LayanX project after handoff

The delivery manager records a per-file size and SHA-256 checksum for supported project files, and a matching machine-observed Outcome report. The new **offline verifier** reads those records and checks the current project files without invoking the LLM, running scripts, or opening external accounts.

## Run on Windows PowerShell

From your LayanX-AI checkout, run:

```powershell
npm run delivery:verify -- "C:\Users\<WindowsUser>\LayanX-Projects\<project>" "<job-id>"
```

The project path and job ID come from the Supervisor job card or the `acceptance-result.json` produced by `npm run acceptance:live:local`.

The command returns JSON with `ok`, `checkedFiles`, `blockers` and `warnings`. Exit code 0 requires no blockers or unverified files. Exit code 1 means the delivery cannot currently be confirmed; exit code 2 means required arguments are missing.

## What is checked

- A matching `.layanx/deliveries/<job-id>.json` and readable handoff guide exist.
- A matching `.layanx/outcomes/<job-id>.json` reports `verified` for the same job.
- Each listed file still exists inside the requested workspace, has the expected size and matches its SHA-256.
- Unexpected new files or missing previously listed files make the result fail. Known private files, dependencies and local metadata remain excluded by the original inventory policy.
- Unsafe relative paths, symlinks pointing outside the workspace, and duplicate paths are rejected.
- Projects exceeding the currently supported 500-file inventory limit cannot be reported as completely indexed.

## Important limits

This proves **local consistency**, not end-to-end feature correctness. It does not re-run the app, check its user interface, certify every acceptance criterion, or validate third-party services. The delivery manifest is not digitally signed; someone with write access can alter both the project and its manifest. Files larger than the current 8 MiB checksum threshold are reported as unverified, not silently certified.

For a real functional acceptance test, run `npm run acceptance:live:local` on Windows with your local Ollama model and inspect the generated `acceptance-result.json`. No external credentials are needed.
