---
title: Next.js app (App Router)
tags: [next, nextjs, next.js, react, ssr, seo, app router, page, موقع]
stacks: [node]
---
1. Pages live in app/<route>/page.tsx; shared UI in app/layout.tsx; keep server components by default and add "use client" only where state or events are needed.
2. Data fetching in server components or route handlers (app/api/<name>/route.ts); validate inputs there.
3. SEO: export metadata (title, description, openGraph) per page; use next/image for images with width/height.
4. Secrets only in server code (process.env without NEXT_PUBLIC_); anything NEXT_PUBLIC_ is visible to everyone.
5. Security headers in next.config (headers()): Content-Security-Policy, X-Content-Type-Options, Referrer-Policy, frame-ancestors.
Checks: npm run build (it type-checks), npm run lint, browser.test on the main routes.
