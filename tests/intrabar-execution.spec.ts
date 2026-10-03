import assert from "node:assert/strict";
import { simulateExit } from "../src/trading/intrabar-execution.js";

const baseCandle = {
  timestamp: "2026-10-03T15:00:00Z",
  open: 1999,
  high: 2002,
  low: 1998,
  close: 2001,
};

const ambiguous = simulateExit(
  { side: "long", stopLossPrice: 1998.5, takeProfitPrice: 2001.5 },
  baseCandle,
  0.2,
  0.05,
  "conservative",
);
assert.ok(ambiguous);
assert.equal(ambiguous.reason, "stop-loss");
assert.equal(ambiguous.intrabarAmbiguous, true);
assert.equal(ambiguous.gapThrough, false);
assert.equal(ambiguous.referencePrice, 1998.5);

const gap = simulateExit(
  { side: "long", stopLossPrice: 2000, takeProfitPrice: 2002 },
  { ...baseCandle, open: 1997.5 },
  0.2,
  0.05,
  "conservative",
);
assert.ok(gap);
assert.equal(gap.reason, "stop-loss");
assert.equal(gap.gapThrough, true);
assert.equal(gap.referencePrice, 1997.5);
assert.equal(gap.price, 1997.35);

const optimistic = simulateExit(
  { side: "short", stopLossPrice: 2001, takeProfitPrice: 1998.5 },
  baseCandle,
  0.2,
  0.05,
  "optimistic",
);
assert.ok(optimistic);
assert.equal(optimistic.reason, "take-profit");
assert.equal(optimistic.intrabarAmbiguous, true);

console.log("Intrabar execution tests passed");
