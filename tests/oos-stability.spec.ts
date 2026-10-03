import assert from "node:assert/strict";
import { analyzeOosStability } from "../src/trading/oos-stability.js";

const base = {
  initialBalance: 1000,
  finalBalance: 1000,
  netPnl: 0,
  returnPct: 0,
  trades: 2,
  wins: 1,
  losses: 1,
  winRate: 50,
  grossProfit: 2,
  grossLoss: 1,
  profitFactor: 2,
  expectancyPerTrade: 0.5,
  maxDrawdown: 10,
  maxDrawdownPct: 1,
  executionCosts: 0,
  commissions: 0,
  swaps: 0,
  costErasedTrades: 0,
};

const result = {
  windows: [
    { window: {} as never, train: base, test: { ...base, netPnl: 10, returnPct: 1, expectancyPerTrade: 0.5 } },
    { window: {} as never, train: base, test: { ...base, netPnl: -5, returnPct: -0.5, expectancyPerTrade: -0.25 } },
    { window: {} as never, train: base, test: { ...base, netPnl: 0, returnPct: 0, expectancyPerTrade: 0, trades: 0 } },
  ],
  aggregateTest: base,
};

const stability = analyzeOosStability(result);
assert.equal(stability.windows, 3);
assert.equal(stability.testWindowsWithTrades, 2);
assert.equal(stability.profitableWindows, 1);
assert.equal(stability.losingWindows, 1);
assert.equal(stability.flatWindows, 0);
assert.equal(stability.profitableWindowRate, 50);
assert.equal(stability.medianReturnPct, 0.25);
assert.equal(stability.minReturnPct, -0.5);
assert.equal(stability.maxReturnPct, 1);
assert.equal(stability.positiveExpectancyWindows, 1);
assert.equal(stability.negativeExpectancyWindows, 1);

console.log("OOS stability tests passed");
