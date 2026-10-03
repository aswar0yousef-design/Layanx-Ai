import assert from "node:assert/strict";
import { runPaperScalping } from "../src/trading/paper-scalping.js";
import type { MarketCandle } from "../src/trading/scalping-signal.js";

const candles: MarketCandle[] = Array.from({ length: 40 }, (_, i) => {
  const close = 100 + i * 0.2;
  return {
    timestamp: new Date(Date.parse("2026-10-03T08:00:00Z") + i * 60_000).toISOString(),
    open: close - 0.05,
    high: close + 0.10,
    low: close - 0.10,
    close,
  };
});

const result = runPaperScalping(candles, {
  symbol: "XAUUSD",
  timeframe: "M1",
  initialBalance: 1000,
  riskPercent: 1,
  stopLossDistance: 1,
  spread: 0.05,
  slippage: 0.02,
});

assert.equal(result.analyses.length, result.trades.length);
assert.ok(result.blockedSignals >= 0);
assert.ok(result.finalBalance > 0);

for (const trade of result.trades) {
  assert.notEqual(trade.openedAt, trade.metadata?.signalTimestamp);
  assert.ok(trade.closedAt >= trade.openedAt);
}

for (const trade of result.trades) {
  if (trade.side === "long") {
    assert.ok(trade.exit.fillPrice < trade.entry.fillPrice);
  } else {
    assert.ok(trade.exit.fillPrice > trade.entry.fillPrice);
  }
}

console.log("Paper scalping tests passed");
