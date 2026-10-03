import type { TradeAnalysis, TradeRecord } from "./trade-record.js";
import { analyzeTradeRecord } from "./trade-record.js";

export interface TradeAnalyticsFilter {
  symbol?: string;
  strategy?: string;
  timeframe?: string;
  session?: string;
}

export interface TradeAnalyticsSummary {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossPnl: number;
  executionCosts: number;
  commissions: number;
  swaps: number;
  netPnl: number;
  costErasedTrades: number;
  avgSpreadAtrRatio: number | null;
  avgDurationMs: number | null;
  byQuality: Record<string, number>;
}

export function analyzeTrades(trades: TradeRecord[], filter: TradeAnalyticsFilter = {}): TradeAnalysis[] {
  return trades.filter(t =>
    (!filter.symbol || t.symbol === filter.symbol) &&
    (!filter.strategy || t.strategy === filter.strategy) &&
    (!filter.timeframe || t.timeframe === filter.timeframe) &&
    (!filter.session || t.session === filter.session)
  ).map(analyzeTradeRecord);
}

export function summarizeTrades(trades: TradeRecord[], filter: TradeAnalyticsFilter = {}): TradeAnalyticsSummary {
  const analyzed = analyzeTrades(trades, filter);
  const wins = analyzed.filter(t => t.trueNetPnl > 0).length;
  const losses = analyzed.filter(t => t.trueNetPnl <= 0).length;
  const ratios = analyzed.map(t => t.spreadAtrRatio).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const durations = analyzed.map(t => t.durationMs).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const byQuality: Record<string, number> = {};
  for (const t of analyzed) byQuality[t.quality] = (byQuality[t.quality] ?? 0) + 1;

  return {
    trades: analyzed.length,
    wins,
    losses,
    winRate: analyzed.length ? wins / analyzed.length : 0,
    grossPnl: analyzed.reduce((s, t) => s + t.grossPnl, 0),
    executionCosts: analyzed.reduce((s, t) => s + (t.estimatedRoundTripCost ?? 0), 0),
    commissions: analyzed.reduce((s, t) => s + t.commission, 0),
    swaps: analyzed.reduce((s, t) => s + t.swap, 0),
    netPnl: analyzed.reduce((s, t) => s + t.trueNetPnl, 0),
    costErasedTrades: analyzed.filter(t => t.grossPnl > 0 && t.trueNetPnl <= 0).length,
    avgSpreadAtrRatio: ratios.length ? ratios.reduce((s, v) => s + v, 0) / ratios.length : null,
    avgDurationMs: durations.length ? durations.reduce((s, v) => s + v, 0) / durations.length : null,
    byQuality
  };
}
