import assert from "node:assert/strict";
import { analyzeExecutionQuality } from "../src/trading/execution-quality.js";

const result = analyzeExecutionQuality({
  id: "xau-1",
  symbol: "XAUUSD",
  side: "long",
  quantity: 1,
  entry: { fillPrice: 100.12, referencePrice: 100, spread: 0.10, atr: 1, slippage: 0.02 },
  exit: { fillPrice: 101.01, referencePrice: 101, spread: 0.10, slippage: 0.03 },
});

assert.equal(result.spreadAtrRatio, 0.1);
assert.equal(result.entrySlippageAtrRatio, 0.02);
assert.equal(result.exitSlippageAtrRatio, 0.03);

console.log("Execution ratio tests passed");
