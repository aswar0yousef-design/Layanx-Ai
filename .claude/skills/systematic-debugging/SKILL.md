---
name: systematic-debugging
description: Root-cause-first debugging workflow for bugs, test failures, and unexpected behavior.
---

# Systematic Debugging

Use this workflow before proposing or applying any fix.

## Phase 1 — Establish evidence
1. Read the full error and relevant logs.
2. Reproduce the failure deterministically; if it cannot be reproduced, gather evidence rather than guessing.
3. Trace the data and control flow across component boundaries, recording the state entering and leaving each boundary.
4. Check recent changes and inspect the caller/callee chain to find where the bad state originates.

## Phase 2 — Compare patterns
1. Find a working path in the same codebase.
2. Compare the working and failing paths, including state, permissions, configuration, and return values.
3. Follow existing architecture and reuse existing mechanisms.

## Phase 3 — Test one hypothesis
1. State one falsifiable root-cause hypothesis.
2. Add the smallest regression test that fails before the fix.
3. Change one thing at a time; do not bundle unrelated refactors.

## Phase 4 — Verify
1. Confirm the regression test fails before the fix and passes after it.
2. Run relevant targeted tests, typecheck, security checks, and the full suite when available.
3. Inspect the final diff and report exact commands/results. Never claim checks passed unless they actually ran.

## Stop conditions
- If evidence does not support the hypothesis, revise it instead of stacking speculative fixes.
- After repeated failed fixes, reconsider the design and discuss architectural changes before continuing.
- Preserve user data, local-only constraints, and existing working behavior.
