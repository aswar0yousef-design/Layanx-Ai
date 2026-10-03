import assert from "node:assert/strict";
import { buildBacktestSegmentReport } from "../src/trading/backtest-segmentation.js";

const base = {
  symbol: "XAUUSD",
  quantity: 1,
  openedAt: "2026-10-03T10:00:00Z",
  closedAt: "2026-10-03T10:01:00Z",
  entry: { fillPrice: 2000, referencePrice: 2000, spread: 0.1, atr: 1 },
  exit: { fillPrice: 2001, referencePrice: 2001, spread: 0.1 },
  strategy: "scalp",
  session: "London",
};

const analyses = [
  { ...base, id: "1", side: "long" as const, trendRegime: "bullish-trend" as const, volatilityRegime: "normal-volatility" as const, grossPnl: 1 },
  { ...base, id: "2", side: "short" as const, trendRegime: "range" as const, volatilityRegime: "high-volatility" as const, grossPnl: -0.5 },
];

const report = buildBacktestSegmentReport(1000, analyses.map((trade) => ({
  ...trade,
  executionQuality: trade.grossPnl > 0 ? "good" as const : "poor" as const,
  executionCost: 0.1,
  netPnlAfterExecutionCosts: trade.grossPnl - 0.1,
  executionCostPct: 10,
  spreadAtrRatio: 0.1,
  warnings: [],
  trueNetPnl: trade.grossPnl - 0.1,
  commission: 0,
  swap: 0,
})));

assert.deepEqual(report.byTrendRegime.map(x => x.key), ["bullish-trend", "range"]);
assert.deepEqual(report.byVolatilityRegime.map(x => x.key), ["high-volatility", "normal-volatility"]);
console.log("Regime segmentation tests passed");
