import type { TradeSide } from "./execution-quality.js";
import type { MarketCandle } from "./scalping-signal.js";
import { generateScalpingSignal } from "./scalping-signal.js";
import { analyzeTradeRecord, type TradeRecord } from "./trade-record.js";
import { evaluateScalpingDecision } from "./scalping-decision.js";

export interface PaperTradingConfig {
  symbol: string;
  timeframe: string;
  initialBalance: number;
  riskPercent: number;
  stopLossDistance: number;
  spread: number;
  expectedSlippage?: number;
  pointValue?: number;
  minimumQuantity?: number;
  maximumQuantity?: number;
  quantityStep?: number;
}

export interface PaperTrade {
  id: string;
  side: TradeSide;
  quantity: number;
  entryPrice: number;
  stopLossPrice: number;
  openedAt: string;
}

export interface PaperTradingResult {
  finalBalance: number;
  trades: TradeRecord[];
  analyses: ReturnType<typeof analyzeTradeRecord>[];
  blockedSignals: number;
}

function stopPrice(side: TradeSide, entry: number, distance: number): number {
  return side === "long" ? entry - distance : entry + distance;
}

function closeAtNextCandle(
  trade: PaperTrade,
  candle: MarketCandle,
): { exitPrice: number; closedAt: string } | null {
  if (trade.side === "long" && candle.low <= trade.stopLossPrice) {
    return { exitPrice: trade.stopLossPrice, closedAt: candle.timestamp };
  }
  if (trade.side === "short" && candle.high >= trade.stopLossPrice) {
    return { exitPrice: trade.stopLossPrice, closedAt: candle.timestamp };
  }
  return null;
}

export function runPaperScalping(
  candles: MarketCandle[],
  config: PaperTradingConfig,
): PaperTradingResult {
  if (candles.length < 31) {
    throw new Error("At least 31 candles are required.");
  }
  if (config.initialBalance <= 0 || config.riskPercent <= 0) {
    throw new Error("Initial balance and risk percent must be positive.");
  }
  if (config.spread < 0 || config.stopLossDistance <= 0) {
    throw new Error("Spread must be non-negative and stop-loss distance must be positive.");
  }

  let balance = config.initialBalance;
  let openTrade: PaperTrade | null = null;
  let sequence = 0;
  let blockedSignals = 0;
  const trades: TradeRecord[] = [];

  for (let i = 30; i < candles.length; i += 1) {
    const history = candles.slice(0, i + 1);
    const candle = candles[i];

    if (openTrade) {
      const closed = closeAtNextCandle(openTrade, candle);
      if (closed) {
        const record: TradeRecord = {
          id: openTrade.id,
          symbol: config.symbol,
          side: openTrade.side,
          quantity: openTrade.quantity,
          entry: { fillPrice: openTrade.entryPrice },
          exit: { fillPrice: closed.exitPrice },
          openedAt: openTrade.openedAt,
          closedAt: closed.closedAt,
          timeframe: config.timeframe,
          strategy: "paper-scalping",
        };
        const analysis = analyzeTradeRecord(record);
        balance += analysis.trueNetPnl;
        trades.push(record);
        openTrade = null;
      }
      continue;
    }

    const signal = generateScalpingSignal(history);
    if (signal.action === "neutral") {
      blockedSignals += 1;
      continue;
    }

    const entry = candle.close;
    const stop = stopPrice(signal.action, entry, config.stopLossDistance);
    const decision = evaluateScalpingDecision({
      candles: history,
      market: {
        symbol: config.symbol,
        timeframe: config.timeframe,
        spread: config.spread,
        expectedSlippage: config.expectedSlippage,
        atr: signal.indicators.atr,
        timestamp: candle.timestamp,
      },
      risk: {
        stopLossPrice: stop,
        accountBalance: balance,
        riskPercent: config.riskPercent,
        pointValue: config.pointValue,
        minimumQuantity: config.minimumQuantity,
        maximumQuantity: config.maximumQuantity,
        quantityStep: config.quantityStep,
      },
    });

    if (!decision.executable || decision.action !== signal.action) {
      blockedSignals += 1;
      continue;
    }

    const riskPlan = decision.riskPlan;
    if (!riskPlan.valid || riskPlan.quantity <= 0) {
      blockedSignals += 1;
      continue;
    }

    sequence += 1;
    openTrade = {
      id: `paper-${sequence}`,
      side: decision.action,
      quantity: riskPlan.quantity,
      entryPrice: entry,
      stopLossPrice: stop,
      openedAt: candle.timestamp,
    };
  }

  return {
    finalBalance: balance,
    trades,
    analyses: trades.map(analyzeTradeRecord),
    blockedSignals,
  };
}
