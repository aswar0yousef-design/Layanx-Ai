import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Sidebar, Topbar } from "./components/Shell.jsx";
import { Glass } from "./components/ui.jsx";
import { t } from "./i18n.js";
import Overview from "./pages/Overview.jsx";
import Pipeline from "./pages/Pipeline.jsx";
import Tasks from "./pages/Tasks.jsx";

const PAGES = { overview: Overview, pipeline: Pipeline, tasks: Tasks };
const ACTION = { pipeline: "newDeal", tasks: "newTask", overview: "newDeal" };
const SUB = { pipeline: "pipelineSub", tasks: "tasksSub" };

function readStored(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export default function App() {
  const [lang, setLang] = useState(() => readStored("dash.lang", "en"));
  const [page, setPage] = useState(() => readStored("dash.page", "overview"));

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    try { localStorage.setItem("dash.lang", lang); localStorage.setItem("dash.page", page); } catch { /* private mode */ }
  }, [lang, page]);

  const Page = PAGES[page];
  return (
    <>
      <div className="aurora" aria-hidden="true" />
      <div className="mx-auto flex max-w-[1500px] gap-4 p-3 sm:p-4">
        <Sidebar lang={lang} page={page} onPage={setPage} />
        <main className="flex min-w-0 flex-1 flex-col gap-4">
          <Topbar lang={lang} page={page} onPage={setPage} onLang={() => setLang((l) => (l === "ar" ? "en" : "ar"))} action={ACTION[page] && t(lang, ACTION[page])} />
          <div className="px-1 pt-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{t(lang, page)}</h1>
            {SUB[page] && <p className="mt-1 text-sm text-muted">{t(lang, SUB[page])}</p>}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={page + lang} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              {Page ? <Page lang={lang} /> : <Glass className="grid min-h-64 place-items-center p-10 text-sm text-muted">{t(lang, "soon")}</Glass>}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </>
  );
}
