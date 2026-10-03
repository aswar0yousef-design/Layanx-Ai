export interface PreTradeMarketSnapshot {
  symbol: string;
  timeframe: string;
  bid?: number;
  ask?: number;
  session?: string;
  spread?: number;
  atr?: number;
  expectedSlippage?: number;
  timestamp?: string;
}

export interface PreTradeExecutionPolicy {
  maxSpreadAtrRatio: number;
  maxExpectedSlippageAtrRatio: number;
  minAtr?: number;
  allowedSessions?: string[];
  requireSpread: boolean;
  requireAtr: boolean;
}

export interface PreTradeCheck {
  name: "atr-present" | "spread-present" | "spread-atr" | "expected-slippage-atr" | "minimum-atr" | "session";
  passed: boolean;
  observed?: number;
  limit?: number;
  message: string;
}

export interface PreTradeGateResult {
  allowed: boolean;
  symbol: string;
  timeframe: string;
  checks: PreTradeCheck[];
  reasons: string[];
  evaluatedAt?: string;
}

const DEFAULT_POLICY: PreTradeExecutionPolicy = {
  maxSpreadAtrRatio: 0.20,
  maxExpectedSlippageAtrRatio: 0.10,
  requireSpread: true,
  requireAtr: true,
};

export function evaluatePreTradeExecutionGate(
  snapshot: PreTradeMarketSnapshot,
  policy: Partial<PreTradeExecutionPolicy> = {}
): PreTradeGateResult {
  const rules = { ...DEFAULT_POLICY, ...policy };
  const checks: PreTradeCheck[] = [];
  const reasons: string[] = [];

  if (rules.requireAtr) {
    const valid = finitePositive(snapshot.atr);
    if (!valid) {
      checks.push({ name: "atr-present", passed: false, message: "ATR is missing or non-positive." });
      reasons.push("ATR is required before execution.");
    }
  }

  if (rules.requireSpread) {
    const valid = finiteNonNegative(snapshot.spread);
    if (!valid) {
      checks.push({ name: "spread-present", passed: false, message: "Spread is missing or negative." });
      reasons.push("Spread is required before execution.");
    }
  }

  if (finitePositive(snapshot.atr) && finiteNonNegative(snapshot.spread)) {
    const ratio = snapshot.spread! / snapshot.atr!;
    const passed = ratio <= rules.maxSpreadAtrRatio;
    checks.push({
      name: "spread-atr",
      passed,
      observed: ratio,
      limit: rules.maxSpreadAtrRatio,
      message: passed
        ? "Spread is within the configured ATR budget."
        : "Spread exceeds the configured ATR budget."
    });
    if (!passed) reasons.push("Spread/ATR threshold exceeded.");
  }

  if (snapshot.expectedSlippage !== undefined) {
    if (finiteNonNegative(snapshot.expectedSlippage) && finitePositive(snapshot.atr)) {
      const ratio = snapshot.expectedSlippage / snapshot.atr!;
      const passed = ratio <= rules.maxExpectedSlippageAtrRatio;
      checks.push({
        name: "expected-slippage-atr",
        passed,
        observed: ratio,
        limit: rules.maxExpectedSlippageAtrRatio,
        message: passed
          ? "Expected slippage is within the configured ATR budget."
          : "Expected slippage exceeds the configured ATR budget."
      });
      if (!passed) reasons.push("Expected slippage/ATR threshold exceeded.");
    } else {
      checks.push({ name: "expected-slippage-atr", passed: false, message: "Expected slippage is invalid." });
      reasons.push("Expected slippage is invalid.");
    }
  }

  if (rules.minAtr !== undefined) {
    const passed = finitePositive(snapshot.atr) && snapshot.atr! >= rules.minAtr;
    checks.push({
      name: "minimum-atr",
      passed,
      observed: snapshot.atr,
      limit: rules.minAtr,
      message: passed ? "ATR meets the configured minimum." : "ATR is below the configured minimum."
    });
    if (!passed) reasons.push("Minimum ATR threshold not met.");
  }

  if (rules.allowedSessions?.length) {
    const passed = typeof snapshot.session === "string" && rules.allowedSessions.includes(snapshot.session);
    checks.push({
      name: "session",
      passed,
      message: passed ? "Session is allowed by policy." : "Session is not allowed by policy."
    });
    if (!passed) reasons.push("Trading session is outside the configured allowlist.");
  }

  return {
    allowed: checks.every(check => check.passed),
    symbol: snapshot.symbol,
    timeframe: snapshot.timeframe,
    checks,
    reasons,
    evaluatedAt: snapshot.timestamp,
  };
}

function finitePositive(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}
