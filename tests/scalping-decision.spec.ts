import assert from "node:assert/strict";
import { evaluateScalpingDecision } from "../src/trading/scalping-decision.js";

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

const decision = evaluateScalpingDecision({
  candles,
  market: {
    symbol: "XAUUSD",
    timeframe: "M1",
    session: "London",
    spread: 0.05,
    atr: 1,
    expectedSlippage: 0.02,
  },
  risk: {
    stopLossPrice: candles[candles.length - 1].close - 1,
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
  executionPolicy: {
    allowedSessions: ["London"],
  },
});

assert.equal(decision.action, "long");
assert.equal(decision.executionGate.allowed, true);
assert.equal(decision.riskPlan?.valid, true);
assert.equal(decision.riskPlan?.entryPrice, candles[candles.length - 1].close);
assert.equal(decision.executable, true);

const blocked = evaluateScalpingDecision({
  candles,
  market: {
    symbol: "XAUUSD",
    timeframe: "M1",
    session: "London",
    spread: 0.50,
    atr: 1,
  },
  risk: {
    stopLossPrice: candles[candles.length - 1].close - 1,
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

assert.equal(blocked.action, "long");
assert.equal(blocked.executionGate.allowed, false);
assert.equal(blocked.executable, false);

console.log("scalping decision tests passed");
