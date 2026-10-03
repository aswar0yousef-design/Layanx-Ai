import assert from "node:assert/strict";
import { inspectCandleQuality } from "../src/trading/candle-quality.js";
import { createWalkForwardWindows } from "../src/trading/walk-forward-windows.js";

const candles = Array.from({ length: 70 }, (_, i) => ({
  timestamp: new Date(Date.parse("2026-10-01T08:00:00Z") + i * 60_000).toISOString(),
  open: 100 + i * 0.1,
  high: 100.2 + i * 0.1,
  low: 99.8 + i * 0.1,
  close: 100.1 + i * 0.1,
}));

const quality = inspectCandleQuality(candles, 60_000);
assert.equal(quality.valid, true);
assert.equal(quality.issues.length, 0);

const windows = createWalkForwardWindows(candles, 40, 30, 30);
assert.equal(windows.length, 1);
assert.equal(windows[0].train.length, 40);
assert.equal(windows[0].test.length, 30);

const bad = [...candles];
bad[20] = { ...bad[20], timestamp: bad[19].timestamp };
assert.equal(inspectCandleQuality(bad).valid, false);

console.log("Candle quality and walk-forward window tests passed");
