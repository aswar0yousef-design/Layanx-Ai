import assert from "node:assert/strict";
import { diagnoseMarketData } from "../src/trading/market-data-diagnostics.js";

const candles = Array.from({ length: 5 }, (_, i) => {
  const close = 2000 + i;
  return {
    timestamp: new Date(Date.UTC(2026, 9, 3, 10, i)).toISOString(),
    open: close - 0.1,
    high: close + 0.3,
    low: close - 0.2,
    close,
    bid: close - 0.05,
    ask: close + 0.05,
  };
});

const diagnostics = diagnoseMarketData("XAUUSD", "M1", candles, 60_000);

assert.equal(diagnostics.candles, 5);
assert.equal(diagnostics.quoteCoverage.percentage, 100);
assert.equal(diagnostics.spread?.median, 0.1);
assert.equal(diagnostics.actualIntervalMs?.median, 60_000);
assert.equal(diagnostics.gaps, 0);
assert.equal(diagnostics.quality.valid, true);
assert.equal(diagnostics.warnings.length, 0);

console.log("Market data diagnostics tests passed");
