import { toPreTradeMarketSnapshot } from "./mt5-adapter.js";
import { readMt5MarketData, type Mt5ReadOnlyTransport } from "./mt5-readonly-market-data.js";
import { evaluateScalpingDecision, type ScalpingDecision } from "./scalping-decision.js";
import type { RiskInput } from "./risk-engine.js";
import type { PreTradeExecutionPolicy } from "./pre-trade-execution-gate.js";
import type { ScalpingSignalConfig } from "./scalping-signal.js";

export interface Mt5ReadOnlyScalpingInput {
  transport: Mt5ReadOnlyTransport;
  symbol: string;
  timeframe: string;
  limit: number;
  risk: Omit<RiskInput, "side" | "entryPrice" | "brokerSymbol"> & { stopLossPrice: number };
  signalConfig?: Partial<ScalpingSignalConfig>;
  executionPolicy?: Partial<PreTradeExecutionPolicy>;
  expectedSlippage?: number;
  atr?: number;
}

export interface Mt5ReadOnlyScalpingEvaluation {
  decision: ScalpingDecision;
  bid: number;
  ask: number;
  spread: number;
  specificationSymbol: string;
}

export async function evaluateMt5ReadOnlyScalping(
  input: Mt5ReadOnlyScalpingInput,
): Promise<Mt5ReadOnlyScalpingEvaluation> {
  const market = await readMt5MarketData(input.transport, input.symbol, input.timeframe, input.limit);
  const snapshot = toPreTradeMarketSnapshot(market.snapshot, input.timeframe, input.atr, input.expectedSlippage);

  const decision = evaluateScalpingDecision({
    candles: market.candles,
    market: snapshot,
    risk: {
      ...input.risk,
      brokerSymbol: market.specification,
    },
    signalConfig: input.signalConfig,
    executionPolicy: input.executionPolicy,
  });
