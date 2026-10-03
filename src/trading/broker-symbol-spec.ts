export interface BrokerSymbolSpecification {
  broker: string;
  accountType: string;
  symbol: string;
  contractSize?: number;
  volumeMin: number;
  volumeMax?: number;
  volumeStep: number;
  tickSize: number;
  tickValue: number;
  currency?: string;
  marginCurrency?: string;
  commissionPerUnit?: number;
  swapLongPerUnit?: number;
  swapShortPerUnit?: number;
}

export function validateBrokerSymbolSpecification(spec: BrokerSymbolSpecification): string[] {
  const errors: string[] = [];
  if (!spec.broker.trim()) errors.push("Broker is required.");
  if (!spec.accountType.trim()) errors.push("Account type is required.");
  if (!spec.symbol.trim()) errors.push("Symbol is required.");
  if (!positive(spec.volumeMin)) errors.push("Volume minimum must be positive.");
  if (!positive(spec.volumeStep)) errors.push("Volume step must be positive.");
  if (!positive(spec.tickSize)) errors.push("Tick size must be positive.");
  if (!positive(spec.tickValue)) errors.push("Tick value must be positive.");
  if (spec.volumeMax !== undefined && (!positive(spec.volumeMax) || spec.volumeMax < spec.volumeMin)) {
    errors.push("Volume maximum must be positive and not below volume minimum.");
  }
  return errors;
}

export function priceMoveValuePerUnit(spec: BrokerSymbolSpecification): number {
  const errors = validateBrokerSymbolSpecification(spec);
  if (errors.length) throw new Error(`Invalid broker symbol specification: ${errors.join(" ")}`);
  return spec.tickValue / spec.tickSize;
}

export function normalizeBrokerQuantity(quantity: number, spec: BrokerSymbolSpecification): number {
  const errors = validateBrokerSymbolSpecification(spec);
  if (errors.length) throw new Error(`Invalid broker symbol specification: ${errors.join(" ")}`);
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;

  let normalized = Math.floor((quantity + Number.EPSILON) / spec.volumeStep) * spec.volumeStep;
  if (spec.volumeMax !== undefined) normalized = Math.min(normalized, spec.volumeMax);
  if (normalized < spec.volumeMin) return 0;

  return Number(normalized.toFixed(12));
}

function positive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
