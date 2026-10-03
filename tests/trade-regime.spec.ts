import assert from "node:assert/strict";
import { analyzeTradeRecord } from "../src/trading/trade-record.js";

const analysis = analyzeTradeRecord({
  id: "regime-1",
  symbol: "XAUUSD",
  side: "long",
  quantity: 1,
  entry: { fillPrice: 2000, referencePrice: 2000, spread: 0.1, atr: 1 },
  exit: { fillPrice: 2001, referencePrice: 2001, spread: 0.1 },
  openedAt: "2026-10-03T10:00:00Z",
  closedAt: "2026-10-03T10:02:00Z",
  session: "London",
  trendRegime: "bullish-trend",
  volatilityRegime: "normal-volatility",
});

assert.equal(analysis.session, "London");
assert.equal(analysis.trendRegime, "bullish-trend");
assert.equal(analysis.volatilityRegime, "normal-volatility");

console.log("Trade regime tests passed");
