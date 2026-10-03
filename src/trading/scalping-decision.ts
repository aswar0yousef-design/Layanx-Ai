import type { PreTradeExecutionPolicy, PreTradeGateResult, PreTradeMarketSnapshot } from "./pre-trade-execution-gate.js";
import { evaluatePreTradeExecutionGate } from "./pre-trade-execution-gate.js";
import type { RiskInput, RiskPlan } from "./risk-engine.js";
import { calculateRiskPlan } from "./risk-engine.js";
import type { MarketCandle, ScalpingSignal, ScalpingSignalConfig } from "./scalping-signal.js";
import { generateScalpingSignal } from "./scalping-signal.js";

export interface ScalpingDecisionInput {
  candles: MarketCandle[];
  market: PreTradeMarketSnapshot;
  risk: Omit<RiskInput, "side" | "entryPrice"> & { stopLossPrice: number; entryPrice?: number };
  signalConfig?: Partial<ScalpingSignalConfig>;
  executionPolicy?: Partial<PreTradeExecutionPolicy>;
}

export interface ScalpingDecision {
  action: ScalpingSignal["action"];
  executable: boolean;
  signal: ScalpingSignal;
  executionGate: PreTradeGateResult;
  riskPlan?: RiskPlan;
  reasons: string[];
}

export function evaluateScalpingDecision(input: ScalpingDecisionInput): ScalpingDecision {
  const signal = generateScalpingSignal(input.candles, input.signalConfig);
  const executionGate = evaluatePreTradeExecutionGate(input.market, input.executionPolicy);
  const reasons = [...signal.reasons, ...executionGate.reasons];

  if (signal.action === "neutral") {
    reasons.push("Signal is neutral.");
    return {
      action: signal.action,
      executable: false,
      signal,
      executionGate,
      reasons,
    };
  }

  const quotedEntry = signal.action === "long" ? input.market.ask : input.market.bid;
  const riskPlan = calculateRiskPlan({
    ...input.risk,
    side: signal.action,
    entryPrice: input.risk.entryPrice ?? quotedEntry ?? input.candles[input.candles.length - 1]?.close ?? NaN,
  });

  reasons.push(...riskPlan.errors, ...riskPlan.warnings);
  const executable = executionGate.allowed && riskPlan.valid;

  if (!executionGate.allowed) reasons.push("Pre-trade execution gate blocked the setup.");
  if (!riskPlan.valid) reasons.push("Risk plan is invalid.");

  return {
    action: signal.action,
    executable,
    signal,
    executionGate,
    riskPlan,
    reasons,
  };
}
