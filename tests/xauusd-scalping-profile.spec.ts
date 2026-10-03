import assert from "node:assert/strict";
import { XAUUSD_SCALPING_PROFILE, createXauUsdPaperConfig } from "../src/trading/xauusd-scalping-profile.js";

assert.equal(XAUUSD_SCALPING_PROFILE.symbol, "XAUUSD");
assert.equal(XAUUSD_SCALPING_PROFILE.timeframe, "M1");
assert.equal(XAUUSD_SCALPING_PROFILE.intrabarResolution, "conservative");
assert.equal(XAUUSD_SCALPING_PROFILE.historicalBacktest.requireBidAsk, true);

const config = createXauUsdPaperConfig({
  initialBalance: 10000,
  riskPercent: 0.25,
  stopLossDistance: 2,
  spread: 0.1,
});

assert.equal(config.symbol, "XAUUSD");
assert.equal(config.timeframe, "M1");
assert.equal(config.intrabarResolution, "conservative");
assert.equal(config.riskPercent, 0.25);
assert.equal(config.stopLossDistance, 2);

console.log("XAUUSD scalping profile tests passed");
