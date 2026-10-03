import type { ExecutionTrade, ExecutionQualityResult } from "./execution-quality.js";

export interface TradeRecord extends ExecutionTrade {
  openedAt: string;
  closedAt?: string;
  strategy?: string;
  timeframe?: string;
  session?: string;
  commission?: number;
  swap?: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface TradeAnalysis extends ExecutionQualityResult {
  openedAt: string;
  closedAt?: string;
  durationMs?: number;
  strategy?: string;
  timeframe?: string;
  session?: string;
  commission: number;
  swap: number;
  trueNetPnl: number;
}

export function analyzeTradeRecord(trade: TradeRecord): TradeAnalysis {
  const quality = analyzeExecutionTrade(trade);
  const commission = finiteNumber(trade.commission) ? trade.commission! : 0;
  const swap = finiteNumber(trade.swap) ? trade.swap! : 0;
  const openedAt = Date.parse(trade.openedAt);
  const closedAt = trade.closedAt ? Date.parse(trade.closedAt) : NaN;
  const durationMs = Number.isFinite(openedAt) && Number.isFinite(closedAt) && closedAt >= openedAt
    ? closedAt - openedAt : undefined;
  return {
    ...quality,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    durationMs,
    strategy: trade.strategy,
    timeframe: trade.timeframe,
    session: trade.session,
    commission,
    swap,
    trueNetPnl: quality.netPnlAfterExecutionCosts - commission - swap
  };
}

function finiteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function analyzeExecutionTrade(trade: TradeRecord): ExecutionQualityResult {
  const { analyzeExecutionQuality } = requireAnalysis();
  return analyzeExecutionQuality(trade);
}

// Kept behind a tiny indirection to avoid circular module state if the analytics layer expands.
function requireAnalysis(): typeof import("./execution-quality.js") {
  return executionQualityModule;
}
import * as executionQualityModule from "./execution-quality.js";
