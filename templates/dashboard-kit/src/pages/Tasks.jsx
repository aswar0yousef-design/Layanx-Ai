import { AnimatePresence, motion } from "framer-motion";
import { Check, Mail, Phone, Users, ListTodo } from "lucide-react";
import { useState } from "react";
import { TODAY, tasks as initialTasks } from "../data.js";
import { t } from "../i18n.js";
import { bucketTasks } from "../lib/format.js";
import { Avatar, Glass, Heading, Pill, rise } from "../components/ui.jsx";

const KIND_ICON = { call: Phone, email: Mail, meeting: Users, todo: ListTodo };
const FILTERS = ["all", "call", "email", "meeting", "todo"];
const BUCKETS = ["overdue", "today", "upcoming", "completed"];

function TaskRow({ task, lang, onToggle }) {
  const Icon = KIND_ICON[task.kind] ?? ListTodo;
  return (
    <motion.li layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 12 }} className="flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-white/[0.04]">
      <button
        type="button"
        onClick={() => onToggle(task.id)}
        aria-label={t(lang, task.done ? "markOpen" : "markDone")}
        aria-pressed={task.done}
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${task.done ? "border-good bg-good text-[#0b0d12]" : "border-white/25 hover:border-accent"}`}
      >
        {task.done && <Check size={12} strokeWidth={3} aria-hidden="true" />}
      </button>
      <Icon size={15} className="shrink-0 text-faint" aria-hidden="true" />
      <p className={`min-w-0 flex-1 truncate text-sm ${task.done ? "text-faint line-through" : ""}`}>{task.title}</p>
      <Pill tone={task.priority}>{t(lang, task.priority)}</Pill>
      <span className="hidden w-12 text-end text-[11px] text-faint sm:block">{task.due.slice(5)}</span>
      <Avatar id={task.owner} size={22} />
    </motion.li>
  );
}

export default function Tasks({ lang }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [filter, setFilter] = useState("all");
  const shown = filter === "all" ? tasks : tasks.filter((x) => x.kind === filter);
  const buckets = bucketTasks(shown, TODAY);
  const all = bucketTasks(tasks, TODAY);
  const toggle = (id) => setTasks((list) => list.map((x) => (x.id === id ? { ...x, done: !x.done } : x)));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {BUCKETS.map((b, i) => (
          <Glass
            as={motion.div}
            {...rise(i)}
            key={b}
            className={`px-5 py-4 ${b === "overdue" && all.overdue.length ? "bg-gradient-to-br from-bad/25 to-accent/10" : ""}`}
          >
            <p className="text-xs text-muted">{t(lang, b)}</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight">{all[b].length}</p>
          </Glass>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label={t(lang, "tasks")}>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1.5 text-xs transition-colors ${filter === f ? "bg-white text-[#0b0d12]" : "glass text-muted hover:text-ink"}`}
          >
            {t(lang, f)}
            <span className="ms-1.5 opacity-60">{f === "all" ? tasks.length : tasks.filter((x) => x.kind === f).length}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {BUCKETS.map((b, i) => (
          <Glass as={motion.section} {...rise(i + 4)} key={b} className="min-w-0 p-4">
            <Heading title={`${t(lang, b)} · ${buckets[b].length}`} />
            <ul className="flex flex-col">
              <AnimatePresence mode="popLayout">
                {buckets[b].map((task) => (
                  <TaskRow key={task.id} task={task} lang={lang} onToggle={toggle} />
                ))}
              </AnimatePresence>
            </ul>
            {!buckets[b].length && <p className="py-6 text-center text-xs text-faint">{t(lang, "nothing")}</p>}
          </Glass>
        ))}
      </div>
    </div>
  );
}
