import assert from "node:assert/strict";
import { assertMt5HistoricalReady, importMt5HistoricalCsv } from "../src/trading/mt5-historical-import.js";

const rows = Array.from({ length: 40 }, (_, i) => {
  const close = 2000 + i;
  const time = new Date(Date.UTC(2026, 9, 3, 10, i)).toISOString();
  return `${time},${close - 0.2},${close + 0.5},${close - 0.4},${close},1,${close - 0.05},${close + 0.05}`;
});
const csv = ["timestamp,open,high,low,close,volume,bid,ask", ...rows].join("\n");

const ready = importMt5HistoricalCsv(csv, {
  symbol: "XAUUSD",
  timeframe: "M1",
  source: "MT5-CFI-test",
  expectedIntervalMs: 60_000,
  requireBidAsk: true,
});

assert.equal(ready.quality.valid, true);
assert.equal(ready.quoteCoverage.percentage, 100);
assert.equal(ready.readyForBacktest, true);
assert.equal(ready.sessions.totalCandles, 40);
assert.equal(ready.sessions.unknownCandles, 0);
assert.ok(ready.diagnostics.spread?.median !== undefined);
assert.doesNotThrow(() => assertMt5HistoricalReady(ready));

const withoutQuotes = importMt5HistoricalCsv(
  ["timestamp,open,high,low,close", ...rows.map(row=>row.replace(/,1,[0-9]+\\.[0-9]+,[0-9]+\\.[0-9]+$/,""))].join("\\n"),
  { symbol: "XAUUSD", timeframe: "M1", requireBidAsk: true },
);
assert.equal(withoutQuotes.readyForBacktest, false);

console.log("MT5 historical import tests passed");
