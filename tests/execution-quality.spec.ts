import assert from "node:assert/strict";
import { analyzeExecutionQuality, summarizeExecutionQuality } from "../src/trading/execution-quality.js";

const result = analyzeExecutionQuality({
  id: "T1", symbol: "XAUUSD", side: "long", quantity: 1,
  entry: { fillPrice: 2350.10, referencePrice: 2350.05, spread: 0.10, atr: 1.00 },
  exit: { fillPrice: 2350.95, referencePrice: 2350.90, spread: 0.10 }
});
assert.equal(result.spreadAtrRatio, 0.1);
assert.equal(result.quality, "excellent");
assert.equal(result.netPnlAfterExecutionCosts, 0.75);
assert.ok(Math.abs((result.executionCostPctOfGross ?? 0) - 11.764705882352942) < 1e-9);

const erased = analyzeExecutionQuality({
  id: "T2", symbol: "XAUUSD", side: "long", quantity: 1,
  entry: { fillPrice: 2350.10, spread: 0.60, atr: 1.00 },
  exit: { fillPrice: 2350.20, spread: 0.60 },
  grossPnl: 0.10
});
assert.equal(erased.quality, "poor");
assert.equal(erased.netPnlAfterExecutionCosts, -0.5);
assert.ok(erased.warnings.some(w => w.includes("not profitable")));

const summary = summarizeExecutionQuality([result, erased]);
assert.equal(summary.trades, 2);
assert.equal(summary.costErasedTrades, 1);
assert.equal(summary.grossPnl, 0.95);
assert.equal(summary.netPnlAfterExecutionCosts, 0.25);
console.log("execution quality tests passed");
