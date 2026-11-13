import { motion } from "framer-motion";
import { BarChart3, Bell, Columns3, Languages, LayoutGrid, ListChecks, Menu, Plus, Search, Settings, Sparkles, Users, X } from "lucide-react";
import { useState } from "react";
import { t } from "../i18n.js";
import { user } from "../data.js";
import { Progress } from "./ui.jsx";

export const NAV = [
  { group: "workspace", items: [{ id: "overview", icon: LayoutGrid }, { id: "tasks", icon: ListChecks, badge: 3 }] },
  { group: "sales", items: [{ id: "pipeline", icon: Columns3 }, { id: "customers", icon: Users }] },
  { group: "insights", items: [{ id: "reports", icon: BarChart3 }, { id: "settings", icon: Settings }] },
];

function NavList({ lang, page, onPage }) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {NAV.map((g) => (
        <div key={g.group}>
          <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint">{t(lang, g.group)}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map(({ id, icon: Icon, badge }) => {
              const active = page === id;
              return (
                <li key={id} className="relative">
                  {active && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-white/[0.08] ring-1 ring-white/10" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                  <button
                    type="button"
                    onClick={() => onPage(id)}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}
                  >
                    <Icon size={17} aria-hidden="true" className={active ? "text-accent" : ""} />
                    <span className="flex-1 text-start">{t(lang, id)}</span>
                    {badge ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">{badge}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SidebarBody({ lang, page, onPage }) {
  return (
    <div className="flex h-full flex-col gap-6 p-4">
      <div className="flex items-center gap-2.5 px-2 pt-1">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-accent to-[#7c5cff] shadow-lg shadow-accent/30">
          <Sparkles size={16} className="text-white" aria-hidden="true" />
        </span>
        <span className="text-[15px] font-semibold tracking-tight">{t(lang, "brand")}</span>
      </div>
      <NavList lang={lang} page={page} onPage={onPage} />
      <div className="mt-auto flex flex-col gap-3">
        <div className="glass-strong rounded-xl p-3">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span className="text-muted">{t(lang, "goal")}</span>
            <span className="font-semibold">92%</span>
          </div>
          <Progress value={92} />
        </div>
        <div className="flex items-center gap-3 rounded-xl px-2 py-1">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-[#ff9a62] to-accent text-xs font-semibold text-white">{user.initials}</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-faint">{user.role}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Sidebar(props) {
  return (
    <aside className="glass sticky top-4 hidden h-[calc(100vh-2rem)] w-64 shrink-0 rounded-3xl lg:block">
      <SidebarBody {...props} />
    </aside>
  );
}

export function Topbar({ lang, page, onPage, onLang, action }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <header className="glass sticky top-4 z-20 flex items-center gap-3 rounded-2xl px-3 py-2.5 sm:px-4">
        <button type="button" className="rounded-lg p-2 text-muted hover:text-ink lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu size={18} />
        </button>
        <label className="relative hidden flex-1 sm:block">
          <span className="sr-only">{t(lang, "search")}</span>
          <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
          <input
            type="search"
            placeholder={t(lang, "search")}
            className="w-full max-w-md rounded-xl border border-white/10 bg-white/[0.04] py-2 ps-9 pe-14 text-sm text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none"
          />
          <kbd className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-white/10 px-1.5 text-[10px] text-faint md:block">⌘K</kbd>
        </label>
        <div className="ms-auto flex items-center gap-2">
          <button type="button" onClick={onLang} className="flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs text-muted hover:bg-white/5 hover:text-ink">
            <Languages size={15} aria-hidden="true" />
            {t(lang, "language")}
          </button>
          <button type="button" className="relative rounded-xl p-2 text-muted hover:bg-white/5 hover:text-ink" aria-label="Notifications">
            <Bell size={17} />
            <span className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-accent ring-2 ring-[#0b0d12]" />
          </button>
          {action && (
            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-sm font-medium text-white shadow-lg shadow-accent/25"
            >
              <Plus size={16} aria-hidden="true" />
              <span className="hidden sm:inline">{action}</span>
            </motion.button>
          )}
        </div>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setOpen(false)} />
          <motion.aside initial={{ x: lang === "ar" ? 40 : -40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} className="glass-strong absolute inset-y-3 start-3 w-72 rounded-3xl">
            <button type="button" className="absolute end-3 top-3 rounded-lg p-2 text-muted hover:text-ink" onClick={() => setOpen(false)} aria-label="Close menu">
              <X size={18} />
            </button>
            <SidebarBody lang={lang} page={page} onPage={(p) => { onPage(p); setOpen(false); }} />
          </motion.aside>
        </div>
      )}
    </>
  );
}
