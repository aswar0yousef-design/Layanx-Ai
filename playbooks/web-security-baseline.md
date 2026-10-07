---
title: Security baseline for websites and web apps
tags: [security, auth, login, password, session, cookie, csp, headers, أمان, تسجيل]
stacks: [any]
---
1. Headers: Content-Security-Policy (start with default-src 'self'), X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, frame-ancestors 'none', HSTS on HTTPS.
2. Sessions: cookies with HttpOnly, Secure and SameSite=Lax/Strict; rotate the session on login.
3. Passwords: bcrypt or argon2; rate-limit login; generic error message for wrong user or password.
4. Inputs: validate on the server; parameterised SQL; escape output (no innerHTML with user data).
5. Secrets: environment variables only; .env in .gitignore; .env.example without real values.
6. Dependencies: npm audit after installing; update or replace packages with high/critical advisories.
Check: project.security (with the dev server URL) must report no critical or high findings.
