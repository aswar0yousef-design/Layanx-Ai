# LayanX Self-Improvement

LayanX now uses a staged learning loop for reusable procedures.

```
successful mission
   -> learning trace
   -> skill.learn
   -> quarantine + content scan + SHA-256
   -> human review
   -> skill.approve
   -> optional skill.enable
   -> skill.execute
```

## Safety boundaries

- Failed or empty workflows cannot become skills.
- Learned skills are never enabled automatically.
- Learned content is scanned for prompt-injection, credential-exfiltration, destructive-command and reverse-shell patterns.
- The candidate content has a SHA-256 integrity hash.
- Approval re-checks the hash.
- Startup re-checks the hash and scanner verdict before restoring approved/enabled learned skills.
- Skill execution still passes through the existing SkillRuntime project-isolation and permission checks.
- Learned state is stored under `.layanx/skills/pending/`, which is ignored by Git.

This deliberately follows the useful part of modern self-improving-agent designs—procedural memory plus an approval gate—without copying third-party implementation code. Hermes documents a similar separation between memory and procedural skills and supports staged skill-write approval and security scanning. 
