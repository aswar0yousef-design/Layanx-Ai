import assert from "node:assert/strict";
import { evaluateScalpingDecision } from "../src/trading/scalping-decision.js";

const candles = Array.from({ length: 40 }, (_, i) => {
  const close = 2000 + i * 0.4;
  return {
    timestamp: new Date(Date.UTC(2026, 9, 3, 15, i)).toISOString(),
    open: close - 0.1,
    high: close + 0.5,
    low: close - 0.2,
    close,
  };
});

const decision = evaluateScalpingDecision({
  candles,
  market: {
    symbol: "XAUUSD",
    timeframe: "M1",
    bid: 2015.8,
    ask: 2016.0,
    spread: 0.2,
    atr: 1,
    timestamp: candles.at(-1)!.timestamp,
  },
  risk: {
    stopLossPrice: 2015,
    accountBalance: 1000,
    riskPercent: 1,
  },
});

assert.equal(decision.action, "long");
assert.equal(decision.riskPlan?.entryPrice, 2016);

console.log("Scalping decision entry price tests passed");
