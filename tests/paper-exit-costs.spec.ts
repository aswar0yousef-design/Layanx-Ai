import assert from "node:assert/strict";
import { runPaperScalping } from "../src/trading/paper-scalping.js";

const candles = Array.from({ length: 45 }, (_, i) => {
  const close = 2000 + i * 0.5;
  return {
    timestamp: new Date(Date.UTC(2026, 9, 3, 10, i)).toISOString(),
    open: close - 0.05,
    high: close + 0.7,
    low: close - 0.2,
    close,
  };
});

const result = runPaperScalping(candles, {
  symbol: "XAUUSD",
  timeframe: "1m",
  initialBalance: 10000,
  riskPercent: 1,
  stopLossDistance: 0.8,
  takeProfitDistance: 0.5,
  spread: 0.2,
  slippage: 0.05,
});

assert.ok(result.trades.length > 0);
const closed = result.trades[0];
assert.equal(closed.exit.spread, 0.2);
assert.equal(closed.exit.slippage, 0.05);
assert.notEqual(closed.exit.referencePrice, closed.exit.fillPrice);
assert.ok(Math.abs((closed.exit.fillPrice as number) - (closed.exit.referencePrice as number)) >= 0.15);

console.log("Paper exit cost tests passed");
