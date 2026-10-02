# Git Safety, Checkpoints and Rollback

Wave 12 adds explicit version-control safety primitives for agent project work.

## Tools

- `git.checkpoint` — returns the exact current commit SHA.
- `git.branch` — creates an isolated non-protected branch.
- `git.rollback` — restores a non-protected branch to an exact 40-character commit SHA.
- Existing `git.status`, `git.diff`, `git.add`, `git.commit`, and `git.push` remain available.

## Safety boundaries

- Branch creation and rollback are L4 dangerous operations and therefore use the existing approval pipeline.
- `main` and `master` are protected from agent-created repair branches.
- Rollback on `main` or `master` is blocked.
- Rollback accepts only an exact commit SHA; arbitrary Git revision expressions are rejected.
- All operations remain inside the configured project workspace.
- Git uses `shell:false`, bounded output, and disabled interactive credential prompts.
- Pushes to protected branches remain disabled unless explicitly enabled by the existing environment control.

## Recommended repair lifecycle

```
checkpoint
   ↓
approved isolated repair branch
   ↓
modify
   ↓
test / verify
   ├── success → commit
   └── failure → rollback to checkpoint
```

The branch and rollback primitives are deliberately explicit. Autonomous repair does not silently bypass the approval system to create branches or rewrite history.
