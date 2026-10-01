# LayanX Security Model

## Trust boundary
LLMs, agents, skills, MCP tools, websites, files and generated code are untrusted by default.

## Enforcement path
Identity -> Project Isolation -> Mission -> Capability -> Skill/Tool Scope -> Permission -> Risk -> Approval -> Sentinel -> Budget -> Execution -> Verification -> Audit.

## Red-team coverage
The repository includes adversarial checks for cross-project access, capability scope bypass, approval scope bypass, secret persistence in memory, and Sentinel bypass attempts.

## Rule
Security controls must be enforced at runtime; tests and documentation are not substitutes for enforcement.

## Secret handling
Secrets must be resolved through a broker or external secret manager. Do not commit credentials, tokens or private keys to the repository.
