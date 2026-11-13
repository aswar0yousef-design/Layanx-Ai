import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { deals as initialDeals, stages } from "../data.js";
import { t } from "../i18n.js";
import { groupByStage, moveDeal, shortMoney, total } from "../lib/format.js";
import { Avatar, Glass, Progress, rise } from "../components/ui.jsx";

function DealCard({ deal, color, lang, onDragStart }) {
  return (
    <motion.article
      layout
      layoutId={deal.id}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      whileHover={{ y: -3 }}
      draggable
      onDragStart={(e) => onDragStart(e, deal.id)}
      className="glass-strong relative cursor-grab rounded-xl p-3.5 active:cursor-grabbing"
      aria-label={`${deal.title}, ${shortMoney(deal.value)}`}
    >
      <p className="text-[11px] text-faint">{deal.company}</p>
      <p className="mt-0.5 text-sm font-medium leading-snug">{deal.title}</p>
      <div className="mt-3 flex items-center gap-3">
        <span className="text-sm font-semibold">{shortMoney(deal.value)}</span>
        <div className="flex-1">
          <Progress value={deal.progress} color={color} />
        </div>
        <span className="text-[11px] text-faint">{deal.progress}%</span>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <Avatar id={deal.owner} size={22} />
        <span className="inline-flex items-center gap-1 text-[11px] text-faint">
          <CalendarDays size={12} aria-hidden="true" />
          <span className="sr-only">{t(lang, "due")}</span>
          {deal.due.slice(5)}
        </span>
      </div>
    </motion.article>
  );
}

export default function Pipeline({ lang }) {
  const [deals, setDeals] = useState(initialDeals);
  const [over, setOver] = useState(null);
  const groups = groupByStage(deals, stages);
  const onDragStart = (e, id) => e.dataTransfer.setData("text/deal", id);
  const onDrop = (e, stage) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/deal");
    if (id) setDeals((d) => moveDeal(d, id, stage));
    setOver(null);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[["kpi_pipeline", total(deals.filter((d) => d.stage !== "won"))], ["kpi_won", total(groups.won)], ["proposal", total(groups.proposal)], ["negotiation", total(groups.negotiation)]].map(([key, value], i) => (
          <Glass as={motion.div} {...rise(i)} key={key} className="px-5 py-4">
            <p className="text-xs text-muted">{t(lang, key)}</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{shortMoney(value)}</p>
          </Glass>
        ))}
      </div>
      <div className="scroll-x relative -mx-1 flex gap-4 overflow-x-auto px-1 pb-3">
        {stages.map((s, i) => (
          <Glass
            as={motion.section}
            {...rise(i + 4)}
            key={s.id}
            aria-label={t(lang, s.id)}
            onDragOver={(e) => { e.preventDefault(); setOver(s.id); }}
            onDragLeave={() => setOver((o) => (o === s.id ? null : o))}
            onDrop={(e) => onDrop(e, s.id)}
            className={`flex w-72 shrink-0 flex-col gap-3 p-3 transition-shadow ${over === s.id ? "ring-2 ring-accent/60" : ""}`}
          >
            <header className="flex items-center justify-between px-1 pt-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                <h3 className="text-sm font-semibold">{t(lang, s.id)}</h3>
                <span className="rounded-full bg-white/8 px-1.5 text-[11px] text-muted">{groups[s.id].length}</span>
              </div>
              <span className="text-xs text-faint">{shortMoney(total(groups[s.id]))}</span>
            </header>
            <div className="flex min-h-24 flex-col gap-2.5">
              <AnimatePresence mode="popLayout">
                {groups[s.id].map((d) => (
                  <DealCard key={d.id} deal={d} color={s.color} lang={lang} onDragStart={onDragStart} />
                ))}
              </AnimatePresence>
              {!groups[s.id].length && <p className="grid flex-1 place-items-center rounded-xl border border-dashed border-white/10 py-8 text-xs text-faint">{t(lang, "emptyStage")}</p>}
            </div>
          </Glass>
        ))}
      </div>
    </div>
  );
}
