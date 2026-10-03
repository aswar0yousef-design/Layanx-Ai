import assert from "node:assert/strict";
import { evaluatePreTradeExecutionGate } from "../src/trading/pre-trade-execution-gate.js";

const allowed = evaluatePreTradeExecutionGate({
  symbol: "XAUUSD",
  timeframe: "M1",
  session: "London",
  spread: 0.10,
  atr: 1,
  expectedSlippage: 0.05,
}, { allowedSessions: ["London", "New York"] });

assert.equal(allowed.allowed, true);
assert.equal(allowed.reasons.length, 0);

const blockedSpread = evaluatePreTradeExecutionGate({
  symbol: "XAUUSD",
  timeframe: "M1",
  session: "London",
  spread: 0.30,
  atr: 1,
});

assert.equal(blockedSpread.allowed, false);
assert.ok(blockedSpread.reasons.includes("Spread/ATR threshold exceeded."));

const blockedSlip = evaluatePreTradeExecutionGate({
  symbol: "XAUUSD",
  timeframe: "M1",
  session: "London",
  spread: 0.10,
  atr: 1,
  expectedSlippage: 0.15,
});

assert.equal(blockedSlip.allowed, false);
assert.ok(blockedSlip.reasons.includes("Expected slippage/ATR threshold exceeded."));

const blockedMissing = evaluatePreTradeExecutionGate({
  symbol: "XAUUSD",
  timeframe: "M1",
  session: "London",
});

assert.equal(blockedMissing.allowed, false);
assert.ok(blockedMissing.reasons.includes("ATR is required before execution."));
assert.ok(blockedMissing.reasons.includes("Spread is required before execution."));
assert.equal(blockedMissing.checks.find((check) => check.name === "atr-present")?.passed, false);
assert.equal(blockedMissing.checks.find((check) => check.name === "spread-present")?.passed, false);

const blockedSession = evaluatePreTradeExecutionGate({
  symbol: "XAUUSD",
  timeframe: "M1",
  session: "Asia",
  spread: 0.05,
  atr: 1,
}, { allowedSessions: ["London"] });

assert.equal(blockedSession.allowed, false);
assert.ok(blockedSession.reasons.includes("Trading session is outside the configured allowlist."));

console.log("pre-trade execution gate tests passed");
