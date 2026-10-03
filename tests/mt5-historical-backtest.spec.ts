import assert from "node:assert/strict";
import { importMt5HistoricalCsv } from "../src/trading/mt5-historical-import.js";
import { runMt5HistoricalBacktest } from "../src/trading/mt5-historical-backtest.js";

const rows = Array.from({ length: 40 }, (_, i) => {
  const close = 2000 + i * 0.2;
  const time = new Date(Date.UTC(2026, 9, 3, 10, i)).toISOString();
  return `${time},${close - 0.1},${close + 0.3},${close - 0.2},${close},${close - 0.05},${close + 0.05}`;
});
const data = importMt5HistoricalCsv(
  ["timestamp,open,high,low,close,bid,ask", ...rows].join("\n"),
  { symbol: "XAUUSD", timeframe: "M1", expectedIntervalMs: 60_000, requireBidAsk: true },
);

const result = runMt5HistoricalBacktest({
  data,
  config: {
    symbol: "XAUUSD",
    timeframe: "M1",
    initialBalance: 10000,
    riskPercent: 1,
    stopLossDistance: 1,
    takeProfitDistance: 0.5,
    spread: 0.1,
    slippage: 0.01,
  },
});

assert.equal(result.symbol, "XAUUSD");
assert.equal(result.candles, 40);
assert.equal(result.simulation.quoteCoverage.percentage, 100);

const noQuotes = importMt5HistoricalCsv(
  rows.map((row) => row.replace(/,[0-9]+\.[0-9]+,[0-9]+\.[0-9]+$/, "")).reduce((acc, row, i) => i === 0 ? acc + row : acc + "\n" + row, "timestamp,open,high,low,close"),
  { symbol: "XAUUSD", timeframe: "M1", requireBidAsk: false },
);
assert.throws(
  () => runMt5HistoricalBacktest({
    data: noQuotes,
    config: {
      symbol: "XAUUSD", timeframe: "M1", initialBalance: 10000, riskPercent: 1,
      stopLossDistance: 1, spread: 0.1,
    },
  }),
);

console.log("MT5 historical backtest tests passed");
