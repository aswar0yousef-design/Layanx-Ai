import assert from "node:assert/strict";
import { runCsvBacktest } from "../src/trading/historical-backtest.js";

const rows = ["timestamp,open,high,low,close"];
for (let i = 0; i < 35; i += 1) {
  const close = 100 + i * 0.2;
  rows.push([
    new Date(Date.parse("2026-10-03T08:00:00Z") + i * 60_000).toISOString(),
    close - 0.05,
    close + 0.1,
    close - 0.1,
    close,
  ].join(","));
}

const result = runCsvBacktest(rows.join("\n"), {
  source: "synthetic-xauusd",
  symbol: "XAUUSD",
  timeframe: "M1",
}, {
  symbol: "XAUUSD",
  timeframe: "M1",
  initialBalance: 1000,
  riskPercent: 1,
  stopLossDistance: 1,
  spread: 0.05,
  expectedSlippage: 0.01,
});

assert.equal(result.source, "synthetic-xauusd");
assert.equal(result.symbol, "XAUUSD");
assert.equal(result.candles, 35);
assert.equal(result.report.initialBalance, 1000);
assert.equal(result.report.trades, result.simulation.analyses.length);
assert.ok(result.report.finalBalance > 0);

console.log("Historical backtest tests passed");
