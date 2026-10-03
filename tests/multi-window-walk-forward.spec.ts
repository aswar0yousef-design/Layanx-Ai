import assert from "node:assert/strict";
import { runMultiWindowWalkForward } from "../src/trading/multi-window-walk-forward.js";

const candles = Array.from({ length: 100 }, (_, i) => ({
  timestamp: new Date(Date.parse("2026-10-01T08:00:00Z") + i * 60_000).toISOString(),
  open: 100 + i * 0.1,
  high: 100.2 + i * 0.1,
  low: 99.8 + i * 0.1,
  close: 100.1 + i * 0.1,
}));

const result = runMultiWindowWalkForward(candles, {
  symbol: "XAUUSD",
  timeframe: "M1",
  initialBalance: 1000,
  riskPercent: 1,
  stopLossDistance: 1,
  spread: 0.05,
}, 40, 30, 30);

assert.equal(result.windows.length, 2);
assert.equal(result.windows[0].window.train.length, 40);
assert.equal(result.windows[0].window.test.length, 30);
assert.equal(result.aggregateTest.initialBalance, 1000);
assert.equal(result.aggregateTest.trades >= 0, true);

assert.throws(
  () => runMultiWindowWalkForward(candles, {
    symbol: "EURUSD",
    timeframe: "M1",
    initialBalance: 1000,
    riskPercent: 1,
    stopLossDistance: 1,
    spread: 0.05,
  }, 40, 30, 30),
  /Backtest data symbol EURUSD does not match config symbol EURUSD/,
);

console.log("Multi-window walk-forward tests passed");
