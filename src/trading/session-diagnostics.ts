import { detectTradingSession, type TradingSession } from "./session.js";
import type { MarketCandle } from "./scalping-signal.js";

export interface SessionDiagnostic {
  session: TradingSession;
  candles: number;
  percentage: number;
  start?: string;
  end?: string;
}

export interface SessionDiagnostics {
  totalCandles: number;
  bySession: SessionDiagnostic[];
  unknownCandles: number;
  dominantSession?: TradingSession;
  concentrationPct: number;
  warnings: string[];
}

export function diagnoseSessions(candles: MarketCandle[]): SessionDiagnostics {
  const groups = new Map<TradingSession, MarketCandle[]>();
  for (const candle of candles) {
    const session = detectTradingSession(candle.timestamp);
    const group = groups.get(session) ?? [];
    group.push(candle);
    groups.set(session, group);
  }

  const total = candles.length;
  const bySession = [...groups.entries()]
    .map(([session, group]) => ({
      session,
      candles: group.length,
      percentage: total ? (group.length / total) * 100 : 0,
      start: group[0]?.timestamp,
      end: group[group.length - 1]?.timestamp,
    }))
    .sort((a, b) => b.candles - a.candles);

  const dominantSession = bySession[0]?.session;
  const concentrationPct = bySession[0]?.percentage ?? 0;
  const unknownCandles = groups.get("Unknown")?.length ?? 0;
  const warnings: string[] = [];

  if (unknownCandles > 0) warnings.push(`${unknownCandles} candle(s) fall outside the configured session windows.`);
  if (total > 0 && concentrationPct >= 60) {
    warnings.push("The historical sample is concentrated in one trading session.");
  }

  return {
    totalCandles: total,
    bySession,
    unknownCandles,
    dominantSession,
    concentrationPct,
    warnings,
  };
}
