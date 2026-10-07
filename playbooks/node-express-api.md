---
title: Node.js REST API with Express
tags: [api, rest, express, node, backend, endpoint, server, route, خادم, واجهة]
stacks: [node]
---
Structure: src/app.(ts|js) builds the app, src/server listens, src/routes/<resource>.ts, src/services for logic, tests/ with supertest.
1. Validate every input (zod, joi or express-validator) at the route boundary; return 400 with a clear message.
2. Security baseline: app.use(helmet()), express-rate-limit on auth and write routes, CORS with an explicit origin list, JSON body limit (e.g. 100kb).
3. Never build SQL with strings: use parameterised queries or the ORM. Hash passwords with bcrypt/argon2.
4. Errors: one error-handling middleware; never send stack traces in responses.
5. Config from environment variables; commit .env.example only.
6. Tests: supertest against the app object (no real port) for happy path, validation error and auth failure.
Checks: npm test, npm run build/typecheck if present.
