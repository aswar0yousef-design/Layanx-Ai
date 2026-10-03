import assert from "node:assert/strict";
import { evaluateMt5ReadOnlyScalping } from "../src/trading/mt5-readonly-scalping.js";
import type { Mt5ReadOnlyTransport } from "../src/trading/mt5-readonly-market-data.js";

const candles = Array.from({ length: 40 }, (_, i) => {
  const close = 2000 + i * 0.3;
  return {
    timestamp: new Date(Date.UTC(2026, 9, 3, 14, i)).toISOString(),
    open: close - 0.1,
    high: close + 0.4,
    low: close - 0.2,
    close,
  };
});

const transport: Mt5ReadOnlyTransport = {
  async getSymbolSnapshot(symbol) {
    return { symbol, bid: 2011.8, ask: 2012.0, timestamp: candles.at(-1)!.timestamp };
  },
  async getCandles() { return candles; },
  async getSymbolSpecification(symbol) {
    return {
      broker: "CFI",
      accountType: "CFI2-Real",
      symbol,
      volumeMin: 0.01,
      volumeStep: 0.01,
      volumeMax: 50,
      tickSize: 0.01,
      tickValue: 1,
    };
  },
};

const result = await evaluateMt5ReadOnlyScalping({
  transport,
  symbol: "XAUUSD",
  timeframe: "M1",
  limit: 40,
  risk: {
    stopLossPrice: 2010.5,
    accountBalance: 1000,
    riskPercent: 1,
  },
});

assert.equal(result.specificationSymbol, "XAUUSD");
assert.equal(result.spread, 0.2);
assert.equal(result.bid, 2011.8);
assert.equal(result.ask, 2012.0);
assert.equal(result.decision.executionGate.allowed, false);

console.log("MT5 read-only scalping tests passed");
