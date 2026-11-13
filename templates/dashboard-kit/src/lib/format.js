/** Money in short form: 846000 -> "$846k", 1250000 -> "$1.25M". */
export function shortMoney(value, currency = "USD", locale = "en-US") {
  return new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 2 }).format(value);
}

/** Percent change between two numbers, rounded to one decimal; 0 when there is no base. */
export function changePercent(current, previous) {
  if (!previous) return 0;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/** Sum of a field across items. */
export function total(items, field = "value") {
  return items.reduce((sum, item) => sum + (Number(item[field]) || 0), 0);
}

/** Deals grouped by stage, in the order of `stages`; unknown stages are dropped. */
export function groupByStage(deals, stages) {
  const groups = Object.fromEntries(stages.map((s) => [s.id, []]));
  for (const deal of deals) if (groups[deal.stage]) groups[deal.stage].push(deal);
  return groups;
}

/** Moves a deal to another stage without changing the original list. */
export function moveDeal(deals, dealId, stage) {
  return deals.map((d) => (d.id === dealId ? { ...d, stage } : d));
}

/** Tasks bucketed against `today` (YYYY-MM-DD): overdue, today, upcoming, completed. */
export function bucketTasks(tasks, today) {
  const out = { overdue: [], today: [], upcoming: [], completed: [] };
  for (const t of tasks) {
    if (t.done) out.completed.push(t);
    else if (t.due < today) out.overdue.push(t);
    else if (t.due === today) out.today.push(t);
    else out.upcoming.push(t);
  }
  return out;
}

/** SVG path for a sparkline/area chart inside a width x height box. */
export function linePath(values, width, height, pad = 2) {
  if (!values.length) return "";
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  return values
    .map((v, i) => `${i ? "L" : "M"}${(pad + i * step).toFixed(1)},${(height - pad - ((v - min) / span) * (height - pad * 2)).toFixed(1)}`)
    .join(" ");
}
