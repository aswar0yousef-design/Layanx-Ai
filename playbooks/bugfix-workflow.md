---
title: Fix a bug without breaking anything else
tags: [bug, fix, error, failing, crash, broken, اصلاح, خطأ, مشكلة, أصلح, اصلح]
stacks: [any]
---
1. Reproduce first: find or write a test that fails because of the bug. Run it and keep the exact error.
2. Read the code path that produces the error (project.knowledge for the map, then files.read). Do not guess.
3. Make the smallest change that makes the failing test pass. Do not refactor unrelated code in the same step.
4. Run the full test suite and the build. Everything that passed before must still pass.
5. If the fix touches shared code, search for other callers (same function/component names) and check them.
6. Record a decision (project.knowledge.record) if the fix changes behaviour others rely on.
Pitfalls: fixing the symptom in one caller while the shared function stays wrong; deleting a failing test instead of fixing the code.
