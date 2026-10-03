import type { TradeSide } from "./execution-quality.js";

export interface RiskInput {
  side: TradeSide;
  entryPrice: number;
  stopLossPrice: number;
  accountBalance: number;
  riskPercent: number;
  pointValue?: number;
  minimumQuantity?: number;
  maximumQuantity?: number;
  quantityStep?: number;
}

export interface RiskPlan {
  valid: boolean;
  side: TradeSide;
  entryPrice: number;
  stopLossPrice: number;
  stopDistance: number;
  riskAmount: number;
  quantity: number;
  actualRiskAmount: number;
  actualRiskPercent: number;
  warnings: string[];
  errors: string[];
}

export function calculateRiskPlan(input: RiskInput): RiskPlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const pointValue = finitePositive(input.pointValue) ? input.pointValue! : 1;
  const stopDistance = Math.abs(input.entryPrice - input.stopLossPrice);
  const riskAmount = input.accountBalance * (input.riskPercent / 100);

  if (!finitePositive(input.accountBalance)) errors.push("Account balance must be positive.");
  if (!finitePositive(input.riskPercent)) errors.push("Risk percent must be positive.");
  if (!finitePositive(stopDistance)) errors.push("Stop-loss must differ from entry price.");
  if (!finitePositive(pointValue)) errors.push("Point value must be positive.");

  if (errors.length) {
    return {
      valid: false, side: input.side, entryPrice: input.entryPrice,
      stopLossPrice: input.stopLossPrice, stopDistance, riskAmount,
      quantity: 0, actualRiskAmount: 0, actualRiskPercent: 0, warnings, errors
    };
  }

  if ((input.side === "long" && input.stopLossPrice >= input.entryPrice) ||
      (input.side === "short" && input.stopLossPrice <= input.entryPrice)) {
    errors.push("Stop-loss is on the wrong side of the entry.");
  }

  let quantity = riskAmount / (stopDistance * pointValue);
  quantity = applyQuantityLimits(quantity, input, warnings);

  const actualRiskAmount = quantity * stopDistance * pointValue;
  const actualRiskPercent = input.accountBalance > 0
    ? (actualRiskAmount / input.accountBalance) * 100
    : 0;

  return {
    valid: errors.length === 0 && quantity > 0,
    side: input.side,
    entryPrice: input.entryPrice,
    stopLossPrice: input.stopLossPrice,
    stopDistance,
    riskAmount,
    quantity,
    actualRiskAmount,
    actualRiskPercent,
    warnings,
    errors
  };
}

function applyQuantityLimits(
  raw: number,
  input: RiskInput,
  warnings: string[]
): number {
  let quantity = raw;

  if (finitePositive(input.maximumQuantity) && quantity > input.maximumQuantity!) {
    quantity = input.maximumQuantity!;
    warnings.push("Calculated quantity was capped at maximum quantity.");
  }

  if (finitePositive(input.minimumQuantity) && quantity < input.minimumQuantity!) {
    warnings.push("Calculated quantity is below minimum quantity.");
    return 0;
  }

  if (finitePositive(input.quantityStep)) {
    quantity = Math.floor(quantity / input.quantityStep!) * input.quantityStep!;
  }

  return Math.max(0, quantity);
}

function finitePositive(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
