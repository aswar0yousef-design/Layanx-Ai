import { AnimatePresence, motion } from "framer-motion";
import { Check, ListChecks, Mail, Phone, Users, ListTodo } from "lucide-react";
import { useState } from "react";
import * as data from "../data.js";
import { t } from "../i18n.js";
import { bucketTasks } from "../lib/format.js";
import { Avatar, Glass, Heading, Pill, rise } from "../components/ui.jsx";

export const meta = { group: "workspace", icon: ListChecks, order: 2, badge: 3, action: "newTask", sub: "tasksSub" };

// Sample data for this page: replace with the project's tasks.
const initialTasks = [
  { id: "t1", title: "Follow up on the renewal call", kind: "call", priority: "high", due: "2026-11-11", owner: "noor", done: false },
  { id: "t2", title: "Send the revised proposal", kind: "email", priority: "high", due: "2026-11-12", owner: "omar", done: false },
  { id: "t3", title: "Product demo with the ops team", kind: "meeting", priority: "medium", due: "2026-11-13", owner: "lina", done: false },
  { id: "t4", title: "Discovery call with a new lead", kind: "call", priority: "medium", due: "2026-11-13", owner: "yusuf", done: false },
  { id: "t5", title: "Update close dates in the pipeline", kind: "todo", priority: "low", due: "2026-11-14", owner: "noor", done: false },
  { id: "t6", title: "Contract review with legal", kind: "meeting", priority: "high", due: "2026-11-15", owner: "omar", done: false },
  { id: "t7", title: "Quarterly business review invite", kind: "email", priority: "low", due: "2026-11-17", owner: "lina", done: false },
  { id: "t8", title: "Thank-you note after signing", kind: "email", priority: "low", due: "2026-11-10", owner: "yusuf", done: true },
  { id: "t9", title: "Share the case study deck", kind: "todo", priority: "medium", due: "2026-11-12", owner: "noor", done: true },
];

const TODAY = data.TODAY ?? new Date().toISOString().slice(0, 10);

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
