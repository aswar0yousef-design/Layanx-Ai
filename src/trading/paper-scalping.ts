import type { TradeSide } from "./execution-quality.js";
import type { MarketCandle } from "./scalping-signal.js";
import { generateScalpingSignal, type ScalpingSignalConfig } from "./scalping-signal.js";
import { analyzeTradeRecord, type TradeRecord } from "./trade-record.js";
import { evaluateScalpingDecision } from "./scalping-decision.js";
import { detectTradingSession } from "./session.js";
import { classifyMarketRegime } from "./market-regime.js";
import type { BrokerSymbolSpecification } from "./broker-symbol-spec.js";
import { simulateExit, type IntrabarResolution } from "./intrabar-execution.js";

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
  brokerSymbol?: BrokerSymbolSpecification;
  intrabarResolution?: IntrabarResolution;
  /** Signal is generated from the last completed candle; execution occurs on the next candle. */
  signalOnClosedCandle?: boolean;
  /** How an open position is handled when historical data ends. */
  endOfDataPolicy?: "close" | "exclude";
  signalConfig?: Partial<ScalpingSignalConfig>;
}

export interface PaperTrade {
  id: string;
  side: TradeSide;
  quantity: number;
  entryPrice: number;
  entryReferencePrice: number;
  stopLossPrice: number;
  takeProfitPrice?: number;
  openedAt: string;
  signalTimestamp: string;
  entrySpread: number;
  entrySlippage: number;
  entryAtr: number;
  entryTrendRegime: ReturnType<typeof classifyMarketRegime>["trend"];
  entryVolatilityRegime: ReturnType<typeof classifyMarketRegime>["volatility"];
}

export interface PaperTradingResult {
  initialBalance: number;
  finalBalance: number;
  trades: TradeRecord[];
  analyses: ReturnType<typeof analyzeTradeRecord>[];
  blockedSignals: number;
  quoteCoverage: { candlesWithBidAsk: number; candlesWithoutBidAsk: number; percentage: number };
}

function stopPrice(side: TradeSide, entry: number, distance: number): number {
  return side === "long" ? entry - distance : entry + distance;
}

function targetPrice(side: TradeSide, entry: number, distance?: number): number | undefined {
  if (distance === undefined) return undefined;
  return side === "long" ? entry + distance : entry - distance;
}

function currentSpread(spread: PaperTradingConfig["spread"], candle: MarketCandle): number {
  if (candle.bid !== undefined && candle.ask !== undefined) return Number((candle.ask - candle.bid).toFixed(12));
  return Number((typeof spread === "function" ? spread(candle) : spread).toFixed(12));
}

function entrySpread(
  spread: PaperTradingConfig["spread"],
  candle: MarketCandle,
): number {
  if (candle.bidOpen !== undefined && candle.askOpen !== undefined) {
    return Number((candle.askOpen - candle.bidOpen).toFixed(12));
  }
  if (candle.bid !== undefined && candle.ask !== undefined) {
    return Number((candle.ask - candle.bid).toFixed(12));
  }
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
  if (config.brokerSymbol && config.brokerSymbol.symbol !== config.symbol) {
    throw new Error("Broker symbol specification does not match paper trading symbol.");
  }
  if (config.stopLossDistance <= 0 || (typeof config.spread === "number" && config.spread < 0)) {
    throw new Error("Stop-loss distance must be positive and spread must be non-negative.");
  }

  const initialBalance = config.initialBalance;
  const commissionPerUnit = config.commissionPerUnit ?? config.brokerSymbol?.commissionPerUnit ?? 0;
  let balance = initialBalance;
  let openTrade: PaperTrade | null = null;
  let sequence = 0;
  let blockedSignals = 0;
  let candlesWithBidAsk = 0;
  let candlesWithoutBidAsk = 0;
  const trades: TradeRecord[] = [];

  const signalOnClosedCandle = config.signalOnClosedCandle ?? true;

  for (let i = 30; i < candles.length; i += 1) {
    const history = signalOnClosedCandle ? candles.slice(0, i) : candles.slice(0, i + 1);
    const candle = candles[i]!;

    if (candle.bid !== undefined && candle.ask !== undefined) candlesWithBidAsk += 1;
    else candlesWithoutBidAsk += 1;

    const spread = currentSpread(config.spread, candle);
    if (spread < 0) throw new Error("Spread must be non-negative.");

    if (openTrade) {
      const slippage = currentSlippage(config.slippage, candle, openTrade.side);
      const exit = simulateExit(
        openTrade,
        candle,
        spread,
        slippage,
        config.intrabarResolution ?? "conservative",
      );

      if (exit) {
        const regime = classifyMarketRegime(history);
        const record: TradeRecord = {
          id: openTrade.id,
          symbol: config.symbol,
          side: openTrade.side,
          quantity: openTrade.quantity,
          entry: {
            fillPrice: openTrade.entryPrice,
            referencePrice: openTrade.entryReferencePrice,
            spread: openTrade.entrySpread,
            atr: openTrade.entryAtr,
            slippage: openTrade.entrySlippage,
          },
          exit: {
            fillPrice: exit.price,
            referencePrice: exit.referencePrice,
            spread,
            slippage,
          },
          openedAt: openTrade.openedAt,
          closedAt: candle.timestamp,
          timeframe: config.timeframe,
          strategy: "paper-scalping",
          session: detectTradingSession(openTrade.openedAt),
          trendRegime: regime.trend,
          volatilityRegime: regime.volatility,
          entryTrendRegime: openTrade.entryTrendRegime,
          entryVolatilityRegime: openTrade.entryVolatilityRegime,
          commission: commissionPerUnit * openTrade.quantity,
          swap: (config.swapPerUnit ?? (
            openTrade.side === "long"
              ? config.brokerSymbol?.swapLongPerUnit
              : config.brokerSymbol?.swapShortPerUnit
          ) ?? 0) * openTrade.quantity,
          metadata: {
            exitReason: exit.reason,
            intrabarAmbiguous: exit.intrabarAmbiguous,
            gapThrough: exit.gapThrough,
            signalTimestamp: openTrade.signalTimestamp,
          },
        };

        const analysis = analyzeTradeRecord(record);
        balance += analysis.trueNetPnl;
        trades.push(record);
        openTrade = null;
      } else {
        updateTrailingStop(openTrade, candle, config.trailingStopDistance);
      }
      continue;
    }

    const signal = generateScalpingSignal(history, config.signalConfig);
    if (signal.action === "neutral") {
      blockedSignals += 1;
      continue;
    }

    const entryReference = signal.action === "long" && candle.askOpen !== undefined
      ? candle.askOpen
      : signal.action === "short" && candle.bidOpen !== undefined
        ? candle.bidOpen
        : signal.action === "long" && candle.ask !== undefined
          ? candle.ask
          : signal.action === "short" && candle.bid !== undefined
            ? candle.bid
            : candle.open;

    const entrySlippage = currentSlippage(config.slippage, candle, signal.action);
    const entrySpreadValue = entrySpread(config.spread, candle);
    const hasHistoricalQuote = signal.action === "long"
      ? candle.askOpen !== undefined || candle.ask !== undefined
      : candle.bidOpen !== undefined || candle.bid !== undefined;
    const entry = hasHistoricalQuote
      ? entryReference + (signal.action === "long" ? entrySlippage : -entrySlippage)
      : signal.action === "long"
        ? entryReference + spread / 2 + entrySlippage
        : entryReference - spread / 2 - entrySlippage;

    const entryRegime = classifyMarketRegime(history);
    const stop = stopPrice(signal.action, entry, config.stopLossDistance);
    const target = targetPrice(signal.action, entry, config.takeProfitDistance);

    const decision = evaluateScalpingDecision({
      candles: history,
      market: {
        symbol: config.symbol,
        timeframe: config.timeframe,
        spread: entrySpreadValue,
        expectedSlippage: entrySlippage,
        atr: signal.indicators.atr,
        timestamp: candle.timestamp,
      },
      risk: {
        stopLossPrice: stop,
        entryPrice: entry,
        accountBalance: balance,
        riskPercent: config.riskPercent,
        pointValue: config.pointValue,
        minimumQuantity: config.minimumQuantity,
        maximumQuantity: config.maximumQuantity,
        quantityStep: config.quantityStep,
        brokerSymbol: config.brokerSymbol,
      },
    });

    if (!decision.executable || decision.action !== signal.action) {
      blockedSignals += 1;
      continue;
    }

    const riskPlan = decision.riskPlan;
    if (!riskPlan || !riskPlan.valid || riskPlan.quantity <= 0) {
      blockedSignals += 1;
      continue;
    }

    sequence += 1;
    openTrade = {
      id: `paper-${sequence}`,
      side: decision.action,
      quantity: riskPlan.quantity,
      entryPrice: entry,
      entryReferencePrice: entryReference,
      stopLossPrice: stop,
      takeProfitPrice: target,
      openedAt: candle.timestamp,
      signalTimestamp: history[history.length - 1]?.timestamp ?? candle.timestamp,
      entrySpread: entrySpreadValue,
      entrySlippage,
      entryAtr: signal.indicators.atr ?? 0,
      entryTrendRegime: entryRegime.trend,
      entryVolatilityRegime: entryRegime.volatility,
    };
  }

  if (openTrade && (config.endOfDataPolicy ?? "close") === "close") {
    const lastCandle = candles[candles.length - 1]!;
    const spread = currentSpread(config.spread, lastCandle);
    const slippage = currentSlippage(config.slippage, lastCandle, openTrade.side);
    const referencePrice = lastCandle.close;
    const exitPrice = openTrade.side === "long"
      ? referencePrice - spread / 2 - slippage
      : referencePrice + spread / 2 + slippage;
    const regime = classifyMarketRegime(candles);
    const record: TradeRecord = {
      id: openTrade.id,
      symbol: config.symbol,
      side: openTrade.side,
      quantity: openTrade.quantity,
      entry: {
        fillPrice: openTrade.entryPrice,
        referencePrice: openTrade.entryReferencePrice,
        spread: openTrade.entrySpread,
        atr: openTrade.entryAtr,
        slippage: openTrade.entrySlippage,
      },
      exit: {
        fillPrice: exitPrice,
        referencePrice,
        spread,
        slippage,
      },
      openedAt: openTrade.openedAt,
      closedAt: lastCandle.timestamp,
      timeframe: config.timeframe,
      strategy: "paper-scalping",
      session: detectTradingSession(openTrade.openedAt),
      trendRegime: regime.trend,
      volatilityRegime: regime.volatility,
      entryTrendRegime: openTrade.entryTrendRegime,
      entryVolatilityRegime: openTrade.entryVolatilityRegime,
      commission: commissionPerUnit * openTrade.quantity,
      swap: (config.swapPerUnit ?? (
        openTrade.side === "long"
          ? config.brokerSymbol?.swapLongPerUnit
          : config.brokerSymbol?.swapShortPerUnit
      ) ?? 0) * openTrade.quantity,
      metadata: {
        exitReason: "end-of-data",
        intrabarAmbiguous: false,
        gapThrough: false,
        signalTimestamp: openTrade.signalTimestamp,
      },
    };
    trades.push(record);
    balance += analyzeTradeRecord(record).trueNetPnl;
    openTrade = null;
  }

  return {
    initialBalance,
    finalBalance: balance,
    trades,
    analyses: trades.map(analyzeTradeRecord),
    blockedSignals,
    quoteCoverage: {
      candlesWithBidAsk,
      candlesWithoutBidAsk,
      percentage: candlesWithBidAsk + candlesWithoutBidAsk === 0
        ? 0
        : (candlesWithBidAsk / (candlesWithBidAsk + candlesWithoutBidAsk)) * 100,
    },
  };
}
