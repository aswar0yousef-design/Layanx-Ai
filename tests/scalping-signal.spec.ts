import assert from "node:assert/strict";
import { atr, ema, generateScalpingSignal, rsi } from "../src/trading/scalping-signal.js";

assert.equal(ema([1, 2, 3], 3), 2);
assert.equal(rsi([1, 2, 3, 4], 3), 100);

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

const value = atr(candles, 14);
assert.ok(typeof value === "number" && value > 0);

const signal = generateScalpingSignal(candles, {
  fastEmaPeriod: 5,
  slowEmaPeriod: 10,
  rsiPeriod: 5,
  atrPeriod: 5,
  minimumScore: 2,
});

assert.equal(signal.action, "long");
assert.ok(signal.score >= 2);
assert.ok(signal.confidence >= 1);
assert.equal(signal.candleTimestamp, candles[candles.length - 1].timestamp);
assert.ok(signal.indicators.fastEma !== undefined);
assert.ok(signal.indicators.slowEma !== undefined);
assert.ok(signal.indicators.rsi !== undefined);
assert.ok(signal.indicators.atr !== undefined);

const insufficient = generateScalpingSignal(candles.slice(0, 4), {
  fastEmaPeriod: 5,
  slowEmaPeriod: 10,
  rsiPeriod: 5,
  atrPeriod: 5,
});

assert.equal(insufficient.action, "neutral");
assert.equal(insufficient.score, 0);

console.log("scalping signal tests passed");
