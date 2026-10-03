import assert from "node:assert/strict";
import { calculateRiskPlan } from "../src/trading/risk-engine.js";

const longPlan = calculateRiskPlan({
  side: "long",
  entryPrice: 2350,
  stopLossPrice: 2349,
  accountBalance: 1000,
  riskPercent: 1,
});

assert.equal(longPlan.valid, true);
assert.equal(longPlan.riskAmount, 10);
assert.equal(longPlan.quantity, 10);
assert.equal(longPlan.actualRiskAmount, 10);
assert.equal(longPlan.actualRiskPercent, 1);

const shortPlan = calculateRiskPlan({
  side: "short",
  entryPrice: 2350,
  stopLossPrice: 2352,
  accountBalance: 1000,
  riskPercent: 1,
  quantityStep: 0.1,
});

assert.equal(shortPlan.valid, true);
assert.equal(shortPlan.quantity, 5);

const wrongStop = calculateRiskPlan({
  side: "long",
  entryPrice: 100,
  stopLossPrice: 101,
  accountBalance: 1000,
  riskPercent: 1,
});

assert.equal(wrongStop.valid, false);
assert.ok(wrongStop.errors.includes("Stop-loss is on the wrong side of the entry."));

const capped = calculateRiskPlan({
  side: "long",
  entryPrice: 100,
  stopLossPrice: 99,
  accountBalance: 1000,
  riskPercent: 5,
  maximumQuantity: 10,
});

assert.equal(capped.valid, true);
assert.equal(capped.quantity, 10);
assert.ok(capped.warnings.includes("Calculated quantity was capped at maximum quantity."));

const brokerPlan = calculateRiskPlan({
  side: "long",
  entryPrice: 2350,
  stopLossPrice: 2349,
  accountBalance: 1000,
  riskPercent: 1,
  brokerSymbol: {
    broker: "test",
    accountType: "demo",
    symbol: "XAUUSD",
    volumeMin: 0.01,
    volumeMax: 100,
    volumeStep: 0.01,
    tickSize: 0.01,
    tickValue: 0.01,
  },
});
assert.equal(brokerPlan.valid, true);
assert.equal(brokerPlan.quantity, 10);
assert.equal(brokerPlan.actualRiskAmount, 10);
assert.equal(brokerPlan.actualRiskPercent, 1);

const invalidRisk = calculateRiskPlan({
  side: "long",
  entryPrice: 100,
  stopLossPrice: 99,
  accountBalance: 1000,
  riskPercent: 101,
});
assert.equal(invalidRisk.valid, false);
assert.ok(invalidRisk.errors.includes("Risk percent cannot exceed 100."));

console.log("risk engine tests passed");
