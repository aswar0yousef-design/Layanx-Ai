import { filterCompletedMt5Candles, normalizeMt5Timeframe, type Mt5Adapter } from "./mt5-adapter.js";
import type { PreTradeExecutionPolicy } from "./pre-trade-execution-gate.js";
import { evaluateScalpingDecision, type ScalpingDecision } from "./scalping-decision.js";
import type { ScalpingSignalConfig } from "./scalping-signal.js";

export interface Mt5ScalpingEvaluationInput {
  adapter: Mt5Adapter;
  symbol: string;
  timeframe: string;
  candlesLimit: number;
  risk: {
    stopLossPrice: number;
    accountBalance: number;
    riskPercent: number;
    pointValue?: number;
    minimumQuantity?: number;
    maximumQuantity?: number;
    quantityStep?: number;
  };
  signalConfig?: Partial<ScalpingSignalConfig>;
  executionPolicy?: Partial<PreTradeExecutionPolicy>;
  expectedSlippage?: number;
  atr?: number;
}

export interface Mt5ScalpingEvaluation {
  decision: ScalpingDecision;
  submitted: false;
}

export async function evaluateMt5Scalping(
  input: Mt5ScalpingEvaluationInput
): Promise<Mt5ScalpingEvaluation> {
  const timeframe = normalizeMt5Timeframe(input.timeframe);
  const market = await input.adapter.getSymbolSnapshot(input.symbol);
  const candles = await input.adapter.getCandles({
    symbol: input.symbol,
    timeframe,
    limit: input.candlesLimit,
  });

  const completedCandles = filterCompletedMt5Candles(candles, market.timestamp, timeframe);
  const spread = Math.abs(market.ask - market.bid);
  const decision = evaluateScalpingDecision({
    candles: completedCandles,
    market: {
      symbol: market.symbol,
      timeframe,
      spread,
      atr: input.atr,
      expectedSlippage: input.expectedSlippage,
      timestamp: market.timestamp,
    },
    risk: input.risk,
    signalConfig: input.signalConfig,
    executionPolicy: input.executionPolicy,
  });

  return { decision, submitted: false };
}
