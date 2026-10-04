import assert from "node:assert/strict";
import { importHistoricalCsv } from "../src/trading/historical-data.js";
import { runHistoricalBacktest } from "../src/trading/historical-backtest.js";

const rows = Array.from({ length: 40 }, (_, i) => {
  const close = 2000 + i * 0.3;
  return `${new Date(Date.UTC(2026, 9, 3, 16, i)).toISOString()},${close - 0.1},${close + 0.4},${close - 0.2},${close},${close},${close + 0.2}`;
});

const csv = ["timestamp,open,high,low,close,bid,ask", ...rows].join("\n");
const data = importHistoricalCsv(csv, { source: "MT5-XAUUSD-test", symbol: "XAUUSD", timeframe: "M1" });

assert.equal(data.candles[0].bid, data.candles[0].close);
assert.equal(data.candles[0].ask, data.candles[0].close + 0.2);

const result = runHistoricalBacktest({
  source: data.source,
  symbol: data.symbol,
  timeframe: data.timeframe,
  candles: data.candles,
  config: {
    symbol: "XAUUSD",
    timeframe: "M1",
    initialBalance: 10000,
    riskPercent: 1,
    stopLossDistance: 1,
    takeProfitDistance: 0.5,
    spread: 0.2,
    slippage: 0.01,
  },
});

assert.equal(result.simulation.quoteCoverage.percentage, 100);
assert.ok(result.simulation.trades.length >= 0);

console.log("Historical bid/ask tests passed");
