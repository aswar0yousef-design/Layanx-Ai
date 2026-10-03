import assert from "node:assert/strict";
import { summarizeTrades } from "../src/trading/trade-analytics.js";

const trades = [
  {
    id: "1", symbol: "XAUUSD", side: "long", quantity: 1,
    openedAt: "2026-10-03T07:00:00Z", closedAt: "2026-10-03T07:02:00Z",
    strategy: "scalp", timeframe: "M1", session: "London",
    entry: { fillPrice: 100.05, referencePrice: 100.00, spread: 0.10, atr: 1 },
    exit: { fillPrice: 100.95, referencePrice: 100.90, spread: 0.10 },
    commission: 0.10, swap: 0
  },
  {
    id: "2", symbol: "XAUUSD", side: "long", quantity: 1,
    openedAt: "2026-10-03T07:10:00Z", closedAt: "2026-10-03T07:11:00Z",
    strategy: "scalp", timeframe: "M1", session: "London",
    entry: { fillPrice: 100.10, spread: 0.60, atr: 1 },
    exit: { fillPrice: 100.20, spread: 0.60 },
    grossPnl: 0.10, commission: 0.05, swap: 0
  }
];

const s = summarizeTrades(trades, { strategy: "scalp", timeframe: "M1" });
assert.equal(s.trades, 2);
assert.equal(s.wins, 1);
assert.equal(s.costErasedTrades, 1);
assert.equal(s.byQuality.excellent, 1);
assert.equal(s.byQuality.poor, 1);
assert.ok(s.netPnl < s.grossPnl);
assert.equal(s.avgDurationMs, 90000);
console.log("trade analytics tests passed");
