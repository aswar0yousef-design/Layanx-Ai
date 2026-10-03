import assert from "node:assert/strict";
import { normalizeBrokerQuantity, priceMoveValuePerUnit, validateBrokerSymbolSpecification } from "../src/trading/broker-symbol-spec.js";
import { calculateRiskPlan } from "../src/trading/risk-engine.js";

const xauusd = {
  broker: "CFI",
  accountType: "CFI2-Real",
  symbol: "XAUUSD",
  volumeMin: 0.01,
  volumeMax: 50,
  volumeStep: 0.01,
  tickSize: 0.01,
  tickValue: 1,
};

assert.deepEqual(validateBrokerSymbolSpecification(xauusd), []);
assert.equal(priceMoveValuePerUnit(xauusd), 100);
assert.equal(normalizeBrokerQuantity(0.237, xauusd), 0.23);

const plan = calculateRiskPlan({
  side: "long",
  entryPrice: 2000,
  stopLossPrice: 1999,
  accountBalance: 1000,
  riskPercent: 1,
  brokerSymbol: xauusd,
});

assert.equal(plan.valid, true);
assert.equal(plan.quantity, 0.1);
assert.equal(plan.actualRiskAmount, 10);

console.log("Broker symbol specification tests passed");
