# Project Intelligence

LayanX now includes a bounded static Project Intelligence Engine exposed as the `project.inspect` tool.

## What it does

- Inventories files only inside the requested project workspace.
- Detects common project markers such as `package.json`, TypeScript configuration, README, `src`, tests, and Git metadata.
- Identifies likely application entry points.
- Summarizes file categories/languages and package scripts/dependency counts.
- Skips high-volume/generated directories such as `.git`, `node_modules`, `dist`, `build`, and coverage caches.
- Uses bounded file count, recursion depth, and metadata limits.
- Never executes project code during inspection.
- Caches short-lived results and invalidates the cache when key project markers change.
- Rejects unsafe project identifiers containing path separators.

## API

`GET /v1/projects/:projectId/intelligence`

The endpoint returns a static inventory suitable for planning, diagnostics, code-review preparation, and future autonomous repair workflows.

## Safety boundary

Project Intelligence is an analysis capability (`L2_ANALYZE`). It does not write files, run shell commands, install dependencies, access arbitrary paths, or perform Git operations.

The next integration point is to feed the bounded inventory into mission planning and adaptive execution so the agent can choose tools based on the actual project structure.
