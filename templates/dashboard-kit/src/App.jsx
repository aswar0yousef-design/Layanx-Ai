import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Sidebar, Topbar } from "./components/Shell.jsx";
import { t } from "./i18n.js";

/*
 * Pages are found by themselves: every src/pages/<Name>.jsx with a default export is a page, and its
 * `meta` export puts it in the menu. To add a page, create the file; nothing else needs to change here.
 *   export const meta = { group: "sales", icon: ShoppingBag, order: 2, action: "newOrder", sub: "ordersSub" };
 * No router and no extra packages: the page id is the file name in lower case, and its title is t(lang, id).
 */
const modules = import.meta.glob("./pages/*.jsx", { eager: true });
export const PAGES = Object.entries(modules)
  .filter(([, m]) => typeof m.default === "function")
  .map(([file, m]) => ({ id: file.split("/").pop().replace(/\.jsx$/, "").toLowerCase(), Page: m.default, ...(m.meta ?? {}) }))
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

const GROUP_ORDER = ["workspace", "sales", "insights"];
export const NAV = [...new Set([...GROUP_ORDER, ...PAGES.map((p) => p.group ?? "workspace")])]
  .map((group) => ({ group, items: PAGES.filter((p) => (p.group ?? "workspace") === group) }))
  .filter((g) => g.items.length);

function readStored(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export default function App() {
  const [lang, setLang] = useState(() => readStored("dash.lang", "en"));
  const [page, setPage] = useState(() => {
    const saved = readStored("dash.page", "");
    return PAGES.some((p) => p.id === saved) ? saved : PAGES[0]?.id;
  });

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try { localStorage.setItem("dash.lang", lang); localStorage.setItem("dash.page", page); } catch { /* private mode */ }
  }, [lang, page]);

  const current = PAGES.find((p) => p.id === page) ?? PAGES[0];
  const Page = current?.Page;
  return (
    <>
      <div className="aurora" aria-hidden="true" />
      <div className="mx-auto flex max-w-[1500px] gap-4 p-3 sm:p-4">
        <Sidebar nav={NAV} lang={lang} page={current?.id} onPage={setPage} />
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          <Topbar nav={NAV} lang={lang} page={current?.id} onPage={setPage} onLang={() => setLang((l) => (l === "ar" ? "en" : "ar"))} action={current?.action && t(lang, current.action)} />
          <div className="px-1 pt-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{t(lang, current?.id ?? "")}</h1>
            {current?.sub && <p className="mt-1 text-sm text-muted">{t(lang, current.sub)}</p>}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={(current?.id ?? "") + lang} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              {Page && <Page lang={lang} />}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </>
  );
}
