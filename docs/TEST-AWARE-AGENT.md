# Test-Aware Agent

Wave 13 adds a narrow project verification tool.

## Supported verification scripts

The agent may request only:

- `test`
- `typecheck`
- `build`

The selected script must also exist in the project's `package.json` scripts.

Execution uses:

- project workspace isolation
- `npm run <approved-script>`
- `shell:false`
- CI mode
- 60-second timeout
- bounded stdout/stderr

Arbitrary commands and arbitrary npm scripts are rejected.

## Repair lifecycle

The verification result exposes:

- script
- exit code
- pass/fail
- stdout
- stderr

This output can be fed back into the bounded Autonomous Repair Loop so a failed verification becomes structured diagnostic context rather than an uncontrolled command-execution loop.

Dangerous verification remains subject to the existing L4 approval and security pipeline.
