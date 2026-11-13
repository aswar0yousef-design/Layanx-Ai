import { motion } from "framer-motion";
import { activity, kpis, revenue } from "../data.js";
import { t } from "../i18n.js";
import { changePercent, linePath, shortMoney } from "../lib/format.js";
import { Avatar, Change, Glass, Heading, Sparkline, rise } from "../components/ui.jsx";

const KPI_COLORS = ["#ff7a45", "#7c5cff", "#34d399", "#1fb6c9"];

export function StatCard({ lang, kpi, index }) {
  const change = changePercent(kpi.value, kpi.previous);
  return (
    <Glass as={motion.article} {...rise(index)} whileHover={{ y: -4 }} className="flex flex-col gap-4 p-5">
      <p className="text-xs font-medium text-muted">{t(lang, `kpi_${kpi.id}`)}</p>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-[28px] font-semibold leading-none tracking-tight">{kpi.money ? shortMoney(kpi.value) : kpi.value.toLocaleString()}</p>
          <div className="mt-2">
            <Change value={change} label={` ${t(lang, "vsLast")}`} />
          </div>
        </div>
        <Sparkline values={kpi.trend} color={KPI_COLORS[index % KPI_COLORS.length]} />
      </div>
    </Glass>
  );
}

function RevenueChart({ lang }) {
  const W = 640, H = 220, values = revenue.map((r) => r.value);
  const d = linePath(values, W, H, 8);
  const max = Math.max(...values);
  return (
    <Glass as={motion.section} {...rise(4)} className="p-5 xl:col-span-2">
      <Heading title={t(lang, "revenue")} sub={t(lang, "revenueSub")} action={<span className="text-2xl font-semibold">{shortMoney(max * 1000)}</span>} />
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full" role="img" aria-label={t(lang, "revenue")} preserveAspectRatio="none">
        <defs>
          <linearGradient id="rev-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#ff7a45" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#ff7a45" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.06)" strokeDasharray="4 6" />
        ))}
        <path d={`${d} L${W - 8},${H} L8,${H} Z`} fill="url(#rev-fill)" />
        <motion.path d={d} fill="none" stroke="#ff7a45" strokeWidth="2.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: "easeOut" }} />
      </svg>
      <div className="mt-2 flex justify-between text-[11px] text-faint" dir="ltr">
        {revenue.map((r) => (
          <span key={r.month}>{r.month}</span>
        ))}
      </div>
    </Glass>
  );
}

function Activity({ lang }) {
  return (
    <Glass as={motion.section} {...rise(5)} className="p-5">
      <Heading title={t(lang, "activity")} />
      <ul className="flex flex-col gap-4">
        {activity.map((a) => (
          <li key={a.id} className="flex items-start gap-3">
            <Avatar id={a.who} size={30} />
            <div className="min-w-0">
              <p className="text-sm leading-snug text-ink/90">{a.text[lang] ?? a.text.en}</p>
              <p className="mt-0.5 text-xs text-faint">{a.when[lang] ?? a.when.en}</p>
            </div>
          </li>
        ))}
      </ul>
    </Glass>
  );
}

export default function Overview({ lang }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k, i) => (
          <StatCard key={k.id} lang={lang} kpi={k} index={i} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <RevenueChart lang={lang} />
        <Activity lang={lang} />
      </div>
    </div>
  );
}
