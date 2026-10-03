import assert from "node:assert/strict";
import { evaluateMt5Scalping } from "../src/trading/mt5-scalping-evaluation.js";
import type { Mt5Adapter } from "../src/trading/mt5-adapter.js";

const candles = Array.from({ length: 30 }, (_, i) => {
  const close = 100 + i * 0.25;
  return {
    timestamp: new Date(Date.parse("2026-10-03T07:00:00Z") + i * 60_000).toISOString(),
    open: close - 0.05,
    high: close + 0.10,
    low: close - 0.10,
    close,
  };
});

let placeOrderCalled = false;
const adapter: Mt5Adapter = {
  async getSymbolSnapshot(symbol) {
    return { symbol, bid: 107.24, ask: 107.29, timestamp: "2026-10-03T07:30:00Z" };
  },
  async getCandles() {
    return candles;
  },
  async placeOrder() {
    placeOrderCalled = true;
    return { accepted: true, brokerOrderId: "should-not-be-used" };
  },
};

const result = await evaluateMt5Scalping({
  adapter,
  symbol: "XAUUSD",
  timeframe: "m1",
  candlesLimit: 30,
  atr: 1,
  expectedSlippage: 0.02,
  risk: {
    stopLossPrice: 106.25,
    accountBalance: 1000,
    riskPercent: 1,
  },
  signalConfig: {
    fastEmaPeriod: 5,
    slowEmaPeriod: 10,
    rsiPeriod: 5,
    atrPeriod: 5,
    minimumScore: 2,
  },
});

assert.equal(result.decision.action, "long");
assert.equal(result.decision.executionGate.allowed, true);
assert.equal(result.decision.executable, true);
assert.equal(result.submitted, false);
assert.equal(placeOrderCalled, false);

console.log("MT5 scalping dry-run tests passed");
