import { motion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { linePath } from "../lib/format.js";
import { people } from "../data.js";

/** A glass panel. Every surface on the page is one of these. */
export function Glass({ as: Tag = "section", className = "", children, ...rest }) {
  return (
    <Tag className={`glass rounded-2xl ${className}`} {...rest}>
      {children}
    </Tag>
  );
}

/** Section heading: one title, one short line under it. */
export function Heading({ title, sub, action }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Sparkline({ values, color = "var(--color-accent)", width = 112, height = 36 }) {
  const d = linePath(values, width, height);
  const id = `spark-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="overflow-visible">
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${width - 2},${height} L2,${height} Z`} fill={`url(#${id})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Change({ value, label }) {
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? "text-good" : "text-bad"}`}>
      <Icon size={14} aria-hidden="true" />
      {Math.abs(value)}%{label && <span className="font-normal text-faint">{label}</span>}
    </span>
  );
}

export function Avatar({ id, size = 26 }) {
  const p = people[id] ?? { name: "?", hue: 0 };
  const initials = p.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2);
  return (
    <span
      title={p.name}
      className="inline-grid shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white ring-2 ring-[#0b0d12]"
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${p.hue} 80% 60%), hsl(${p.hue + 40} 70% 45%))` }}
    >
      {initials}
    </span>
  );
}

const PRIORITY = { high: "bg-bad/15 text-bad", medium: "bg-warn/15 text-warn", low: "bg-white/8 text-muted" };
export function Pill({ tone = "low", children }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PRIORITY[tone] ?? PRIORITY.low}`}>{children}</span>;
}

export function Progress({ value, color = "var(--color-accent)" }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/8" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${value}%` }} transition={{ duration: 0.8, ease: "easeOut" }} />
    </div>
  );
}

/** Entrance used by every page: content rises in, staggered. */
export const rise = (i = 0) => ({
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] },
});
