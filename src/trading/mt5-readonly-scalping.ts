import { toPreTradeMarketSnapshot } from "./mt5-adapter.js";
import { readMt5MarketData, type Mt5ReadOnlyTransport } from "./mt5-readonly-market-data.js";
import { evaluateScalpingDecision, type ScalpingDecision } from "./scalping-decision.js";

export interface Mt5ReadOnlyScalpingEvaluation {
  decision: ScalpingDecision;
  bid: number;
  ask: number;
  spread: number;
  specificationSymbol: string;
}

export async function evaluateMt5ReadOnlyScalping(
  transport: Mt5ReadOnlyTransport,
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<Mt5ReadOnlyScalpingEvaluation> {
  const market = await readMt5MarketData(transport, symbol, timeframe, limit);
  const snapshot = toPreTradeMarketSnapshot(market.snapshot, timeframe);

  const decision = evaluateScalpingDecision({
    candles: market.candles,
    market: snapshot,
    risk: {
      stopLossPrice: market.candles.at(-1)?.close ?? NaN,
      accountBalance: 1,
      riskPercent: 1,
      brokerSymbol: market.specification,
    },
  });

  return {
    decision,
    bid: market.snapshot.bid,
    ask: market.snapshot.ask,
    spread: snapshot.spread,
    specificationSymbol: market.specification.symbol,
  };
}
