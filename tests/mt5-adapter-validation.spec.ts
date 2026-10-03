import assert from "node:assert/strict";
import { toPreTradeMarketSnapshot } from "../src/trading/mt5-adapter.js";

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

console.log("MT5 adapter validation tests passed");
