# Autonomous Debug & Repair Loop

LayanX can now continue a recoverable mission failure through a bounded repair loop.

## Flow

1. Execute the mission's existing plan.
2. Capture the failed tool result.
3. Re-open the mission in a recoverable running state.
4. Re-scan bounded Project Intelligence.
5. Ask the constrained planner for the next corrective action.
6. Execute the corrective action through the normal runtime security pipeline.
7. Repeat until verification succeeds, the planner has no useful action, a security gate blocks execution, or the repair limit is reached.

## Safety

- Repair attempts are bounded to 1-5; default is 3.
- Repair actions cannot request L5_CRITICAL.
- File writes, terminal commands, and Git operations still pass through the existing permission, capability, Sentinel, approval, budget, and audit controls.
- Approval is not bypassed during autonomous repair.
- A blocked operation stops the loop rather than being retried.
- Project isolation is checked for every repair execution.
- The loop never executes arbitrary shell commands outside the existing terminal allowlist.

## API

POST /v1/missions/:missionId/repair

Request body:

    {
      "projectId": "project-a",
      "maxRepairAttempts": 3,
      "agentId": "core"
    }

The response reports every attempted tool, whether it succeeded, whether repair occurred, and whether the loop was exhausted or blocked.

This is the foundation for the next stage: test-aware diagnosis and Git branch/rollback controls.
