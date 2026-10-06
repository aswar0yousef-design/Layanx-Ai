# Agent Reach integration

LayanX integrates the upstream Agent Reach capability layer as an optional external CLI. LayanX does not vendor or clone Agent Reach into the workspace.

## LayanX tools

- agent-reach.status: machine-readable health and active backend snapshot.
- agent-reach.channels: supported channel registry.
- agent-reach.collect: bounded read-only collection through Agent Reach's stable JSON collection surface.
- agent-reach.update.check: check for a newer Agent Reach release.
- agent-reach.capabilities: LayanX's static capability list.
- agent-reach.setup: safe check by default; system installation requires explicit approval.

## Security

Agent Reach credentials and cookies remain on the local machine. LayanX does not expose posting, liking, or commenting through this integration.
The LayanX project workspace remains separate from Agent Reach's own data directories.

## Installation

Install Agent Reach separately from the LayanX workspace using the upstream installation guide. A safe check should be performed first. System dependency installation must be explicitly approved.

Example user flow:

User: ابحث عن آخر النقاشات حول وكلاء الذكاء الاصطناعي في GitHub وYouTube وX.
LayanX: يفحص Agent Reach، يحدد القنوات المتاحة، ثم ينفذ جمعًا محدودًا للبيانات عبر القنوات المناسبة.

Agent Reach is a capability source, not a second orchestrator. LayanX continues to own missions, permissions, approvals, verification, recovery, memory, scheduling, and audit.
## Automatic research routing

For a normal user request such as `ابحث عن آخر تطورات وكلاء الذكاء الاصطناعي وآراء المستخدمين في GitHub وReddit وYouTube`, LayanX can call `research.internet`. It discovers available channels, chooses relevant channels from the request, runs bounded searches in parallel, and returns normalized per-channel evidence. LayanX remains responsible for synthesis, ranking, memory, citations, and final decisions.
