import assert from "node:assert/strict";
import { classifyMarketRegime } from "../src/trading/market-regime.js";

const candles = Array.from({ length: 100 }, (_, i) => {
  const close = 2000 + i * 0.5;
  return {
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    open: close - 0.1,
    high: close + 0.5,
    low: close - 0.2,
    close,
  };
});

const regime = classifyMarketRegime(candles);
assert.equal(regime.trend, "bullish-trend");
assert.ok(regime.atr !== undefined);
assert.ok(regime.atrRatio !== undefined);
assert.ok(regime.emaSpreadAtrRatio !== undefined);

console.log("Market regime tests passed");
