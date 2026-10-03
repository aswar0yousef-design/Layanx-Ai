import assert from "node:assert/strict";
import { filterCompletedMt5Candles, toPreTradeMarketSnapshot } from "../src/trading/mt5-adapter.js";

const market = toPreTradeMarketSnapshot(
  { symbol: "XAUUSD", bid: 2000, ask: 2000.2, timestamp: "2026-10-03T12:00:00Z" },
  "M1",
  1.2,
  0.03,
);

assert.equal(market.symbol, "XAUUSD");
assert.equal(market.spread, 0.2);

assert.throws(
  () => toPreTradeMarketSnapshot(
    { symbol: "XAUUSD", bid: 2001, ask: 2000.9, timestamp: "2026-10-03T12:00:00Z" },
    "M1",
  ),
  /ask cannot be below bid/,
);


const candle = {
  timestamp: "2026-10-03T11:59:00Z",
  open: 2000,
  high: 2001,
  low: 1999,
  close: 2000.5,
};
const completed = filterCompletedMt5Candles(
  [candle, { ...candle, timestamp: "2026-10-03T12:00:00Z", open: 2000.5, high: 2001.2, low: 2000.1, close: 2001 }],
  "2026-10-03T12:00:30Z",
  "M1",
);
assert.equal(completed.length, 1);
assert.equal(completed[0].timestamp, candle.timestamp);
const futureFiltered = filterCompletedMt5Candles(
  [candle, { ...candle, timestamp: "2026-10-03T12:00:00Z" }, { ...candle, timestamp: "2026-10-03T12:01:00Z" }],
  "2026-10-03T12:00:30Z",
  "M1",
);
assert.equal(futureFiltered.length, 2);

console.log("MT5 adapter validation tests passed");
