import type { TradeAnalysis, TradeRecord } from "./trade-record.js";
import { analyzeTrades, type TradeAnalyticsFilter } from "./trade-analytics.js";

export type ScalpingBucket =
  | "unknown"
  | "excellent-execution"
  | "good-execution"
  | "marginal-execution"
  | "poor-execution";

export interface ScalpingPerformanceSegment {
  key: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossPnl: number;
  netPnl: number;
  executionCosts: number;
  commissions: number;
  swaps: number;
  costErasedTrades: number;
  profitFactor: number | null;
  expectancyPerTrade: number;
  avgSpreadAtrRatio: number | null;
  avgSlippage: number | null;
  avgDurationMs: number | null;
}

export interface ScalpingPerformanceReport {
  filter: TradeAnalyticsFilter;
  trades: number;
  segments: ScalpingPerformanceSegment[];
  executionQuality: ScalpingPerformanceSegment[];
  spreadAtr: ScalpingPerformanceSegment[];
  duration: ScalpingPerformanceSegment[];
  slippage: ScalpingPerformanceSegment[];
}

export function analyzeScalpingPerformance(
  trades: TradeRecord[],
  filter: TradeAnalyticsFilter = {}
): ScalpingPerformanceReport {
  const analyzed = analyzeTrades(trades, filter);

  return {
    filter,
    trades: analyzed.length,
    segments: segment(analyzed, t => t.strategy ?? "unknown"),
    executionQuality: segment(analyzed, t => qualityKey(t.quality)),
    spreadAtr: segment(analyzed, t => spreadAtrBucket(t.spreadAtrRatio)),
    duration: segment(analyzed, t => durationBucket(t.durationMs)),
    slippage: segment(analyzed, t => slippageBucket(t)),
  };
}

function segment(
  trades: TradeAnalysis[],
  keyOf: (trade: TradeAnalysis) => string
): ScalpingPerformanceSegment[] {
  const groups = new Map<string, TradeAnalysis[]>();
  for (const trade of trades) {
    const key = keyOf(trade);
    const group = groups.get(key);
    if (group) group.push(trade);
    else groups.set(key, [trade]);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => summarizeSegment(key, group));
}

function summarizeSegment(key: string, trades: TradeAnalysis[]): ScalpingPerformanceSegment {
  const wins = trades.filter(t => t.trueNetPnl > 0);
  const losses = trades.filter(t => t.trueNetPnl < 0);
  const grossPnl = sum(trades.map(t => t.grossPnl));
  const netPnl = sum(trades.map(t => t.trueNetPnl));
  const executionCosts = sum(trades.map(t => t.estimatedRoundTripCost ?? 0));
  const commissions = sum(trades.map(t => t.commission));
  const swaps = sum(trades.map(t => t.swap));
  const ratios = finiteValues(trades.map(t => t.spreadAtrRatio));
  const slippages = finiteValues(
    trades.flatMap(t => [t.entrySlippage, t.exitSlippage])
  );
  const durations = finiteValues(trades.map(t => t.durationMs));
  const grossWins = sum(wins.map(t => t.trueNetPnl));
  const grossLosses = Math.abs(sum(losses.map(t => t.trueNetPnl)));

  return {
    key,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    grossPnl,
    netPnl,
    executionCosts,
    commissions,
    swaps,
    costErasedTrades: trades.filter(t => t.grossPnl > 0 && t.trueNetPnl <= 0).length,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : (grossWins > 0 ? null : 0),
    expectancyPerTrade: trades.length ? netPnl / trades.length : 0,
    avgSpreadAtrRatio: average(ratios),
    avgSlippage: average(slippages),
    avgDurationMs: average(durations),
  };
}

function qualityKey(value: TradeAnalysis["quality"]): ScalpingBucket {
  return value === "excellent" ? "excellent-execution"
    : value === "good" ? "good-execution"
    : value === "marginal" ? "marginal-execution"
    : value === "poor" ? "poor-execution"
    : "unknown";
}

function spreadAtrBucket(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "unknown";
  if (value <= 0.10) return "0-10% ATR";
  if (value <= 0.20) return "10-20% ATR";
  if (value <= 0.35) return "20-35% ATR";
  return ">35% ATR";
}

function durationBucket(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "unknown";
  if (value <= 60_000) return "0-60s";
  if (value <= 180_000) return "61-180s";
  if (value <= 300_000) return "181-300s";
  return ">300s";
}

function slippageBucket(trade: TradeAnalysis): string {
  const atr = trade.atr;
  const ratios = finiteValues([
    trade.entrySlippageAtrRatio,
    trade.exitSlippageAtrRatio,
    trade.entrySlippage!==undefined&&atr!==undefined&&atr>0?trade.entrySlippage/atr:undefined,
    trade.exitSlippage!==undefined&&atr!==undefined&&atr>0?trade.exitSlippage/atr:undefined
  ]);
  if (!ratios.length) return "unknown";
  const ratio = Math.max(...ratios);
  if (ratio <= 0.05) return "0-5% ATR";
  if (ratio <= 0.10) return "5-10% ATR";
  return ">10% ATR";
}

function finiteValues(values: Array<number | undefined>): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function average(values: number[]): number | null {
  return values.length ? sum(values) / values.length : null;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
