import assert from "node:assert/strict";
import { diagnoseSessions } from "../src/trading/session-diagnostics.js";

const candles = [0, 4, 8, 10, 14, 20, 22].map((hour, i) => ({
  timestamp: `2026-10-03T${String(hour).padStart(2, "0")}:00:00Z`,
  open: 2000, high: 2001, low: 1999, close: 2000,
}));

const result = diagnoseSessions(candles);
assert.equal(result.totalCandles, 7);
assert.ok(result.bySession.some(x => x.session === "Asia"));
assert.ok(result.bySession.some(x => x.session === "London"));
assert.ok(result.bySession.some(x => x.session === "New York"));
assert.equal(result.unknownCandles, 1);
assert.ok(result.warnings.length >= 1);

console.log("Session diagnostics tests passed");
