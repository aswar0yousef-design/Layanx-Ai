# Dashboard kit

An original dark "glass" dashboard: React 18, Vite 6, Tailwind 4, framer-motion, lucide-react.
Pages: Overview (KPI cards, revenue chart, activity), Pipeline (drag deals between stages), Tasks (summary, filters, buckets).
Arabic and English, with the whole layout turning right-to-left in Arabic.

## Where things are

| What | File |
|---|---|
| Colours, fonts, glass look | `src/index.css` (`@theme` tokens and `:root` variables) |
| Every visible word (en + ar) | `src/i18n.js` |
| Shared data (user, people, today) | `src/data.js` |
| Pure logic with tests | `src/lib/format.js`, `src/lib/format.test.js` |
| Glass panel, heading, sparkline, avatar, pill, progress, `rise()` entrance | `src/components/ui.jsx` |
| Sidebar, top bar, mobile menu | `src/components/Shell.jsx` |
| Pages (each file is a page and a menu entry) | `src/pages/*.jsx` |

## Adding a page (one file, nothing else)

```jsx
// src/pages/Orders.jsx  -> page id "orders", title t(lang, "orders")
import { ShoppingBag } from "lucide-react";
import { Glass } from "../components/ui.jsx";
import { t } from "../i18n.js";

export const meta = { group: "sales", icon: ShoppingBag, order: 2, action: "newOrder", sub: "ordersSub" };

export default function Orders({ lang }) {
  return <Glass className="p-5">{t(lang, "ordersSub")}</Glass>;
}
```

Then add `orders`, `newOrder`, `ordersSub` to BOTH `en` and `ar` in `src/i18n.js`.
Do not edit the routing in `src/App.jsx` and do not install a router or any other package.
Delete a page by deleting its file.

## Data

- Each sample page keeps its own sample data at the top of its own file (Overview: kpis, revenue, activity;
  Pipeline: stages, deals; Tasks: tasks). Deleting a page deletes its data with it.
- `src/data.js` holds only what is shared: `TODAY`, `user`, `people`. Shared components read them with
  fallbacks (`import * as data`), so changing this file never breaks the build.
- Put the project's own data in a new page file, or as new exports in `src/data.js` imported where used.

## Rules that keep it professional

- Change the look through tokens only. One accent colour.
- Every surface is `<Glass>`; every entrance is `{...rise(i)}`.
- New text: add the key to both languages in `src/i18n.js` first.
- Grid items get `min-w-0`; phones get one column (or two for small number cards).
- Every list has an empty state. Data looks real.
- Logic goes in `src/lib` with a vitest test; components stay presentational.

## Commands

```
npm install
npm run dev      # http://localhost:5173
npm test
npm run build
```
