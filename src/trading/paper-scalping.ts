import type { TradeSide } from "./execution-quality.js";
import type { MarketCandle } from "./scalping-signal.js";
import { generateScalpingSignal } from "./scalping-signal.js";
import { analyzeTradeRecord, type TradeRecord } from "./trade-record.js";
import { evaluateScalpingDecision } from "./scalping-decision.js";
import { detectTradingSession } from "./session.js";

export interface PaperTradingConfig {
  symbol: string;
  timeframe: string;
  initialBalance: number;
  riskPercent: number;
  stopLossDistance: number;
  takeProfitDistance?: number;
  spread: number | ((candle: MarketCandle) => number);
  slippage?: number | ((candle: MarketCandle, side: TradeSide) => number);
  commissionPerUnit?: number;
  swapPerUnit?: number;
  trailingStopDistance?: number;
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
  takeProfitPrice?: number;
  openedAt: string;
  entrySpread: number;
  entrySlippage: number;
  entryAtr: number;
}

export interface PaperTradingResult {
  initialBalance: number;
  finalBalance: number;
  trades: TradeRecord[];
  analyses: ReturnType<typeof analyzeTradeRecord>[];
  blockedSignals: number;
}

function stopPrice(side: TradeSide, entry: number, distance: number): number {
  return side === "long" ? entry - distance : entry + distance;
}

function targetPrice(side: TradeSide, entry: number, distance?: number): number | undefined {
  if (distance === undefined) return undefined;
  return side === "long" ? entry + distance : entry - distance;
}

function currentSpread(
  spread: PaperTradingConfig["spread"],
  candle: MarketCandle,
): number {
  return typeof spread === "function" ? spread(candle) : spread;
}

function currentSlippage(
  slippage: PaperTradingConfig["slippage"],
  candle: MarketCandle,
  side: TradeSide,
): number {
  const value = typeof slippage === "function" ? slippage(candle, side) : slippage ?? 0;
  if (value < 0) throw new Error("Slippage must be non-negative.");
  return value;
}

function exitPrice(
  trade: PaperTrade,
  candle: MarketCandle,
  spread: number,
  slippage: number,
): { price: number; reason: "stop-loss" | "take-profit" | "trailing-stop" } | null {
  const bid = candle.close - spread / 2;
  const ask = candle.close + spread / 2;

  if (trade.side === "long") {
    if (candle.low <= trade.stopLossPrice) {
      return { price: trade.stopLossPrice - slippage, reason: "stop-loss" };
    }
    if (trade.takeProfitPrice !== undefined && candle.high >= trade.takeProfitPrice) {
      return { price: trade.takeProfitPrice - slippage, reason: "take-profit" };
    }
    return bid < trade.entryPrice ? null : null;
  }

  if (candle.high >= trade.stopLossPrice) {
    return { price: trade.stopLossPrice + slippage, reason: "stop-loss" };
  }
  if (trade.takeProfitPrice !== undefined && candle.low <= trade.takeProfitPrice) {
    return { price: trade.takeProfitPrice + slippage, reason: "take-profit" };
  }
  return ask > trade.entryPrice ? null : null;
}

function updateTrailingStop(trade: PaperTrade, candle: MarketCandle, distance?: number): void {
  if (distance === undefined) return;

  if (trade.side === "long") {
    const candidate = candle.high - distance;
    if (candidate > trade.stopLossPrice) trade.stopLossPrice = candidate;
  } else {
    const candidate = candle.low + distance;
    if (candidate < trade.stopLossPrice) trade.stopLossPrice = candidate;
  }
}

export function runPaperScalping(
  candles: MarketCandle[],
  config: PaperTradingConfig,
): PaperTradingResult {
  if (candles.length < 31) throw new Error("At least 31 candles are required.");
  if (config.initialBalance <= 0 || config.riskPercent <= 0) {
    throw new Error("Initial balance and risk percent must be positive.");
  }
  if (config.stopLossDistance <= 0 || typeof config.spread === "number" && config.spread < 0) {
    throw new Error("Stop-loss distance must be positive and spread must be non-negative.");
  }

  const initialBalance = config.initialBalance;
  let balance = initialBalance;
  let openTrade: PaperTrade | null = null;
  let sequence = 0;
  let blockedSignals = 0;
  const trades: TradeRecord[] = [];

  for (let i = 30; i < candles.length; i += 1) {
    const history = candles.slice(0, i + 1);
    const candle = candles[i];
    const spread = currentSpread(config.spread, candle);
    if (spread < 0) throw new Error("Spread must be non-negative.");

    if (openTrade) {
      updateTrailingStop(openTrade, candle, config.trailingStopDistance);
      const slippage = currentSlippage(config.slippage, candle, openTrade.side);
      const exit = exitPrice(openTrade, candle, spread, slippage);

      if (exit) {
        const record: TradeRecord = {
          id: openTrade.id,
          symbol: config.symbol,
          side: openTrade.side,
          quantity: openTrade.quantity,
          entry: {
            fillPrice: openTrade.entryPrice,
            referencePrice: openTrade.side === "long"
              ? openTrade.entryPrice + openTrade.entrySpread / 2
              : openTrade.entryPrice - openTrade.entrySpread / 2,
            spread: openTrade.entrySpread,
            atr: openTrade.entryAtr,
            slippage: openTrade.entrySlippage,
          },
          exit: {
            fillPrice: exit.price,
            referencePrice: exit.price,
            spread,
            slippage,
          },
          openedAt: openTrade.openedAt,
          closedAt: candle.timestamp,
          timeframe: config.timeframe,
          strategy: "paper-scalping",
          session: detectTradingSession(openTrade.openedAt),
          commission: (config.commissionPerUnit ?? 0) * openTrade.quantity,
          swap: (config.swapPerUnit ?? 0) * openTrade.quantity,
          metadata: { exitReason: exit.reason },
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

    const entryReference = candle.close;
    const entrySlippage = currentSlippage(config.slippage, candle, signal.action);
    const entry = signal.action === "long"
      ? entryReference + spread / 2 + entrySlippage
      : entryReference - spread / 2 - entrySlippage;
    const stop = stopPrice(signal.action, entry, config.stopLossDistance);
    const target = targetPrice(signal.action, entry, config.takeProfitDistance);

    const decision = evaluateScalpingDecision({
      candles: history,
      market: {
        symbol: config.symbol,
        timeframe: config.timeframe,
        spread,
        expectedSlippage: entrySlippage,
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
      takeProfitPrice: target,
      openedAt: candle.timestamp,
      entrySpread: spread,
      entrySlippage,
      entryAtr: signal.indicators.atr,
    };
  }

  return {
    initialBalance,
    finalBalance: balance,
    trades,
    analyses: trades.map(analyzeTradeRecord),
    blockedSignals,
  };
}
