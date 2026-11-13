---
title: Professional dashboard UI (glass, React)
tags: [dashboard, admin, crm, panel, analytics, kpi, pipeline, kanban, glass, glassmorphism, ui, لوحة, تحكم, لوحة تحكم, داشبورد, احترافي, واجهة, مبيعات, تقارير]
stacks: [node, unknown, any]
---
1. Start from the kit, never from a blank file: project.run {task:"template:dashboard"} copies an original React + Vite + Tailwind 4 + framer-motion + lucide-react dashboard (sidebar, top bar, KPI cards with sparklines, revenue chart, drag-and-drop pipeline, task board, Arabic/English with RTL). Then project.run install, test, build.
2. Read KIT.md in the project. Change the look ONLY through the tokens in src/index.css (accent, aurora colours, surface); every surface is <Glass>, every entrance uses rise(i), every word lives in src/i18n.js (en + ar).
3. Fit the owner's domain: rename pages in NAV (components/Shell.jsx), replace src/data.js with the real data shapes, add a page as src/pages/<Name>.jsx and register it in PAGES (App.jsx). Delete pages that do not fit; keep it 3-6 pages.
4. Professional means: one accent colour; numbers big (28px, semibold, tight tracking), labels small and muted; 16px gaps; rounded-2xl panels; realistic data (names, companies, amounts, dates; never lorem ipsum or "Item 1"); an empty state on every list; hover lift of 3-4px; motion under 0.5s; nothing flashes.
5. Grids need min-w-0 on items and grid-cols-1 on phones, or long text widens the page. Absolutely positioned things (sr-only text) inside a scroll area need a relative parent. No horizontal page scroll at 375px or 1280px, in LTR and RTL.
6. Accessibility: real <button>s, aria-label on icon buttons, aria-current on the active page, visible focus, progressbar roles; colour is never the only signal.
Checks: npm test (vitest, pure logic in src/lib), npm run build, then browser.test with desktop and mobile viewports on the dev server; switch to العربية and check again.
