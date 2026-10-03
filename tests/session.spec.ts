import assert from "node:assert/strict";
import { detectTradingSession } from "../src/trading/session.js";

assert.equal(detectTradingSession("2026-10-03T02:00:00Z"), "Asia");
assert.equal(detectTradingSession("2026-10-03T10:00:00Z"), "London");
assert.equal(detectTradingSession("2026-10-03T15:00:00Z"), "New York");
assert.equal(detectTradingSession("2026-10-03T23:00:00Z"), "Unknown");

console.log("Session detection tests passed");
