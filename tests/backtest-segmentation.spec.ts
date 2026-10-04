import assert from "node:assert/strict";
import { buildBacktestSegmentReport } from "../src/trading/backtest-segmentation.js";
import { splitChronologically } from "../src/trading/walk-forward.js";

const analyses = [
  {
    id: "1", symbol: "XAUUSD", side: "long" as const, quantity: 1,
    entry: { fillPrice: 100 }, exit: { fillPrice: 101 },
    openedAt: "2026-10-03T08:00:00Z", closedAt: "2026-10-03T08:01:00Z",
    strategy: "scalp", timeframe: "M1", session: "London",
    commission: 0, swap: 0, grossPnl: 1, executionCost: 0.1,
    executionCostPct: 10, netPnlAfterExecutionCosts: 0.9, trueNetPnl: 0.9,
    quality: "excellent" as const, warnings: [],
  },
  {
    id: "2", symbol: "XAUUSD", side: "short" as const, quantity: 1,
    entry: { fillPrice: 101 }, exit: { fillPrice: 100 },
    openedAt: "2026-10-03T09:00:00Z", closedAt: "2026-10-03T09:01:00Z",
    strategy: "scalp", timeframe: "M1", session: "New York",
    commission: 0, swap: 0, grossPnl: 1, executionCost: 0.2,
    executionCostPct: 20, netPnlAfterExecutionCosts: 0.8, trueNetPnl: 0.8,
    quality: "good" as const, warnings: [],
  },
];

const segments = buildBacktestSegmentReport(1000, analyses);
assert.equal(segments.bySession.length, 2);
assert.equal(segments.bySide.length, 2);
assert.equal(segments.byQuality.length, 2);
assert.equal(segments.byStrategy.length, 1);

const candles = Array.from({ length: 10 }, (_, i) => ({
  timestamp: new Date(Date.parse("2026-10-03T08:00:00Z") + i * 60_000).toISOString(),
  open: i, high: i + 1, low: i - 1, close: i + 0.5,
}));
const split = splitChronologically(candles, 0.7);
assert.equal(split.train.length, 7);
assert.equal(split.test.length, 3);
assert.equal(split.trainEnd, candles[6].timestamp);
assert.equal(split.testStart, candles[7].timestamp);

console.log("Backtest segmentation and split tests passed");
