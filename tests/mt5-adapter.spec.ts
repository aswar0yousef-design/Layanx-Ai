import assert from "node:assert/strict";
import {
  normalizeMt5Timeframe,
  toPreTradeMarketSnapshot,
  type Mt5Adapter,
} from "../src/trading/mt5-adapter.js";

const snapshot = toPreTradeMarketSnapshot({
  symbol: "XAUUSD",
  bid: 2350.10,
  ask: 2350.20,
  timestamp: "2026-10-03T08:00:00Z",
}, "M1", 1.2, 0.03);

assert.equal(snapshot.symbol, "XAUUSD");
assert.equal(snapshot.timeframe, "M1");
assert.equal(snapshot.spread, 0.10);
assert.equal(snapshot.atr, 1.2);
assert.equal(snapshot.expectedSlippage, 0.03);

assert.equal(normalizeMt5Timeframe(" m5 "), "M5");
assert.throws(() => normalizeMt5Timeframe(""));

const adapterContract: Mt5Adapter = {
  async getSymbolSnapshot(symbol) {
    return { symbol, bid: 1, ask: 1.1, timestamp: new Date().toISOString() };
  },
  async getCandles() {
    return [];
  },
  async placeOrder(request) {
    return { accepted: false, message: `Execution adapter not configured: ${request.symbol}` };
  },
};

const order = await adapterContract.placeOrder({
  symbol: "XAUUSD",
  side: "long",
  quantity: 0.1,
});

assert.equal(order.accepted, false);

console.log("MT5 adapter contract tests passed");
