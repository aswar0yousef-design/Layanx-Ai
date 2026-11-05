# Verified delivery + natural voice: implementation track

## Non-negotiable delivery invariant
A successful build or model-written "done" message is not evidence of user requirements.
Each required acceptance criterion needs an independent test with a recorded artifact.
The new `acceptance-evidence.ts` module is an isolated, deterministic first step;
**it is not wired into the supervisor yet**. Do not enable completion blocking
until the supervisor can generate, run, and persist proof mappings for real projects.

## Integration steps
1. Add stable requirement IDs to `SupervisorJob` and persist a requirement-to-test matrix.
2. Extend the check runner to collect test ID, timestamp, result and artifact path.
3. Call `evaluateAcceptance` from the final gate in `supervisor.ts` and block
   `completed` when required criteria lack independent proof.
4. Re-run tests after every repair; invalidate proof on source changes.
5. Preserve crash recovery and approval boundaries; never replay uncertain side effects.
6. Run negative tests: build passes but login fails; missing proof; skipped test;
   restart during verification; revoked tool approval.

## Voice assistant experience
- Keep `src/voice/assistant.ts` and `src/voice/dialogue-brain.ts` as entry points.
- Stream audio and text incrementally; support interruption/barge-in and cancellation.
- Separate STT, dialogue planning, and TTS behind provider interfaces, with
  local/cloud fallback and clear permission/credential handling.
- Add VAD and endpointing, avoid reading raw tool logs aloud, and speak concise
  progress updates while tools execute.
- Maintain Arabic dialect-friendly replies and natural punctuation/prosody.
- Measure end-of-speech to first-audio latency, interruption response, recognition
  accuracy, and task completion, including Windows microphone/speaker tests.
- Never claim ChatGPT voice parity without side-by-side listening tests.

## Harness-inspired interoperability
- Keep one policy-controlled tool registry; adapt MCP tools into its schemas.
- Scope permissions and tool visibility to each agent/project.
- Load skill bodies on demand; cache summaries and invalidate on change.
- Record append-only execution events with durable step IDs and tool outcomes.
- Compare existing runtime against Harness in an isolated benchmark before migration.

## Safety
No real-money trading, merchant mutations, credentials, or unrestricted desktop
control in benchmarks. Require approvals for irreversible operations.
