# Dashboard kit

An original dark "glass" dashboard: React 18, Vite 6, Tailwind 4, framer-motion, lucide-react.
Pages: Overview (KPI cards, revenue chart, activity), Pipeline (drag deals between stages), Tasks (summary, filters, buckets).
Arabic and English, with the whole layout turning right-to-left in Arabic.

## Where things are

| What | File |
|---|---|
| Colours, fonts, glass look | `src/index.css` (`@theme` tokens and `:root` variables) |
| Every visible word (en + ar) | `src/i18n.js` |
| Sample data (replace with real data, same shapes) | `src/data.js` |
| Pure logic with tests | `src/lib/format.js`, `src/lib/format.test.js` |
| Glass panel, heading, sparkline, avatar, pill, progress, `rise()` entrance | `src/components/ui.jsx` |
| Sidebar, top bar, mobile menu, `NAV` | `src/components/Shell.jsx` |
| Pages and the page list (`PAGES`) | `src/pages/*.jsx`, `src/App.jsx` |

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
