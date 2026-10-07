---
title: React UI with Vite
tags: [react, vite, ui, component, page, frontend, form, صفحة, واجهة, مكون]
stacks: [node]
---
1. Find existing components and styles first (project.knowledge map); reuse them instead of creating parallel ones.
2. One component per file under src/components or the feature folder already used by the project.
3. Accessibility: real buttons and labels, alt text on images, keyboard focus visible, lang/dir on <html>.
4. Responsive: test at 390px (mobile) and 1280px (desktop); no horizontal scrolling.
5. Never use dangerouslySetInnerHTML with user content.
6. Tests: vitest + @testing-library/react for behaviour (what the user sees and clicks), not implementation details.
Visual check: npm run dev, then browser.test on the page with desktop and mobile viewports and a baseline.
