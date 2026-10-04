import assert from "node:assert/strict";
import { analyzeScalpingPerformance } from "../src/trading/scalping-performance.js";

const trades = [
  {
    id: "s1", symbol: "XAUUSD", side: "long", quantity: 1,
    openedAt: "2026-10-03T07:00:00Z", closedAt: "2026-10-03T07:00:45Z",
    strategy: "scalp", timeframe: "M1", session: "London",
    entry: { fillPrice: 100.01, referencePrice: 100, spread: 0.05, atr: 1, slippage: 0.01 },
    exit: { fillPrice: 100.51, referencePrice: 100.50, spread: 0.05, slippage: 0.01 },
    commission: 0.02, swap: 0
  },
  {
    id: "s2", symbol: "XAUUSD", side: "long", quantity: 1,
    openedAt: "2026-10-03T07:10:00Z", closedAt: "2026-10-03T07:12:30Z",
    strategy: "scalp", timeframe: "M1", session: "London",
    entry: { fillPrice: 100.10, spread: 0.30, atr: 1, slippage: 0.12 },
    exit: { fillPrice: 100.20, spread: 0.30, slippage: 0.12 },
    grossPnl: 0.10, commission: 0.02, swap: 0
  },
  {
    id: "s3", symbol: "XAUUSD", side: "short", quantity: 1,
    openedAt: "2026-10-03T07:20:00Z", closedAt: "2026-10-03T07:25:30Z",
    strategy: "breakout", timeframe: "M5", session: "New York",
    entry: { fillPrice: 100.20, spread: 0.15, atr: 1, slippage: 0.02 },
    exit: { fillPrice: 99.70, referencePrice: 99.72, spread: 0.15, slippage: 0.02 },
    grossPnl: 0.48, commission: 0.03, swap: 0
  }
];

const report = analyzeScalpingPerformance(trades, { symbol: "XAUUSD" });

assert.equal(report.trades, 3);
assert.equal(report.segments.length, 2);
assert.equal(report.executionQuality.find(x => x.key === "excellent-execution")?.trades, 1);
assert.equal(report.executionQuality.find(x => x.key === "marginal-execution")?.trades, 1);
assert.equal(report.executionQuality.find(x => x.key === "good-execution")?.trades, 1);

assert.equal(report.spreadAtr.find(x => x.key === "0-10% ATR")?.trades, 1);
assert.equal(report.spreadAtr.find(x => x.key === "10-20% ATR")?.trades, 1);

const highSpread = report.spreadAtr.find(x => x.key === "20-35% ATR");
assert.equal(highSpread?.trades, 1);
assert.equal(highSpread?.costErasedTrades, 1);

assert.equal(report.duration.find(x => x.key === "0-60s")?.trades, 1);
assert.equal(report.duration.find(x => x.key === "61-180s")?.trades, 1);
assert.equal(report.duration.find(x => x.key === ">300s")?.trades, 1);

const highSlippage = report.slippage.find(x => x.key === ">10% ATR");
assert.equal(highSlippage?.trades, 1);

const strategy = report.segments.find(x => x.key === "scalp");
assert.equal(strategy?.trades, 2);
assert.equal(strategy?.costErasedTrades, 1);
assert.ok((strategy?.netPnl ?? 0) < (strategy?.grossPnl ?? 0));

console.log("scalping performance tests passed");
