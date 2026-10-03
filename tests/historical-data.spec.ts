import assert from "node:assert/strict";
import { importHistoricalCsv, importHistoricalJson } from "../src/trading/historical-data.js";

const csv = [
  "timestamp,open,high,low,close,volume",
  "2026-10-03T08:01:00Z,100.2,100.5,100.1,100.4,12",
  "2026-10-03T08:00:00Z,100,100.3,99.9,100.2,10",
].join("\n");

const source = importHistoricalCsv(csv, {
  source: "test",
  symbol: "XAUUSD",
  timeframe: "M1",
});

assert.equal(source.candles.length, 2);
assert.equal(source.candles[0].close, 100.2);
assert.equal(source.candles[1].close, 100.4);
assert.equal(source.candles[0].volume, 10);

const json = importHistoricalJson([
  { time: "2026-10-03T08:00:00Z", o: 1, h: 2, l: 0.5, c: 1.5 },
  { time: "2026-10-03T08:01:00Z", o: 1.5, h: 2.2, l: 1.4, c: 2 },
], { symbol: "EURUSD", timeframe: "M1" });

assert.equal(json.candles[1].close, 2);
assert.throws(() => importHistoricalJson([
  { timestamp: "2026-10-03T08:00:00Z", open: 1, high: 0, low: 0, close: 1 },
], { symbol: "XAUUSD", timeframe: "M1" }));
assert.throws(() => importHistoricalCsv(
  "timestamp,open,high,low,close\n2026-10-03T08:00:00Z,1,2,1,1\n2026-10-03T08:00:00Z,1,2,1,1",
  { symbol: "XAUUSD", timeframe: "M1" },
));

console.log("Historical data importer tests passed");
