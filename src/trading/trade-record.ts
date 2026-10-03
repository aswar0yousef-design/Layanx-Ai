import { analyzeExecutionQuality, type ExecutionTrade, type ExecutionQualityResult } from "./execution-quality.js";
import type { MarketTrendRegime, MarketVolatilityRegime } from "./market-regime.js";

export interface TradeRecord extends ExecutionTrade {
  openedAt: string;
  closedAt?: string;
  strategy?: string;
  timeframe?: string;
  session?: string;
  trendRegime?: MarketTrendRegime;
  volatilityRegime?: MarketVolatilityRegime;
  entryTrendRegime?: MarketTrendRegime;
  entryVolatilityRegime?: MarketVolatilityRegime;
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
  trendRegime?: MarketTrendRegime;
  volatilityRegime?: MarketVolatilityRegime;
  commission: number;
  swap: number;
  trueNetPnl: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export function analyzeTradeRecord(trade: TradeRecord): TradeAnalysis {
  const quality = analyzeExecutionQuality(trade);
  const commission = finiteNumber(trade.commission) ? trade.commission : 0;
  const swap = finiteNumber(trade.swap) ? trade.swap : 0;
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
    trendRegime: trade.trendRegime,
    volatilityRegime: trade.volatilityRegime,
    commission,
    swap,
    trueNetPnl: quality.netPnlAfterExecutionCosts - commission - swap,
    metadata: trade.metadata
  };
}

function finiteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
