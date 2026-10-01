# Runtime Recovery CI Verification

This document exists to trigger the pull-request CI gate for the runtime recovery verification already present in `tests/runtime-recovery.spec.ts`.

The verification target is:

- checkpoint restoration
- persisted runtime state
- idempotency replay after recovery
- refusal of unavailable recovery dependencies
- post-resume persistence verification

No runtime behavior is changed by this document.
