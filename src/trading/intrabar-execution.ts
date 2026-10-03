import type { TradeSide } from "./execution-quality.js";
import type { MarketCandle } from "./scalping-signal.js";

export type IntrabarResolution = "conservative" | "optimistic";

export interface ExitSimulation {
  price: number;
  referencePrice: number;
  reason: "stop-loss" | "take-profit" | "trailing-stop";
  intrabarAmbiguous: boolean;
  gapThrough: boolean;
}

function touched(trade: { side: TradeSide; stopLossPrice: number; takeProfitPrice?: number }, candle: MarketCandle) {
  const quoteAware = trade.side === "long"
    ? candle.bidLow !== undefined && candle.bidHigh !== undefined
    : candle.askLow !== undefined && candle.askHigh !== undefined;
  const low = trade.side === "long" ? (quoteAware ? candle.bidLow! : candle.low) : (quoteAware ? candle.askLow! : candle.low);
  const high = trade.side === "long" ? (quoteAware ? candle.bidHigh! : candle.high) : (quoteAware ? candle.askHigh! : candle.high);
  const stop = trade.side === "long"
    ? low <= trade.stopLossPrice
    : high >= trade.stopLossPrice;
  const target = trade.takeProfitPrice !== undefined && (
    trade.side === "long"
      ? high >= trade.takeProfitPrice
      : low <= trade.takeProfitPrice
  );
  return { stop, target, quoteAware };
}

export function simulateExit(
  trade: { side: TradeSide; stopLossPrice: number; takeProfitPrice?: number },
  candle: MarketCandle,
  spread: number,
  slippage: number,
  resolution: IntrabarResolution = "conservative",
): ExitSimulation | null {
  const { stop, target, quoteAware } = touched(trade, candle);
  if (!stop && !target) return null;

  const triggerOpen = quoteAware
    ? trade.side === "long" ? candle.bidOpen : candle.askOpen
    : candle.open;
  const stopGap = triggerOpen !== undefined && (
    trade.side === "long"
      ? triggerOpen <= trade.stopLossPrice
      : triggerOpen >= trade.stopLossPrice
  );
  const targetGap = triggerOpen !== undefined && trade.takeProfitPrice !== undefined && (
    trade.side === "long"
      ? triggerOpen >= trade.takeProfitPrice
      : triggerOpen <= trade.takeProfitPrice
  );

  let reason: "stop-loss" | "take-profit";
  let gapThrough = false;

  if (stopGap || targetGap) {
    gapThrough = true;
    if (stopGap && targetGap) {
      reason = resolution === "optimistic" ? "take-profit" : "stop-loss";
    } else {
      reason = stopGap ? "stop-loss" : "take-profit";
    }
  } else if (stop && target) {
    reason = resolution === "optimistic" ? "take-profit" : "stop-loss";
  } else {
    reason = stop ? "stop-loss" : "take-profit";
  }

  const referencePrice = reason === "stop-loss"
    ? trade.stopLossPrice
    : trade.takeProfitPrice!;

  const gapReference = gapThrough
    ? candle.open
    : referencePrice;

  const direction = trade.side === "long" ? -1 : 1;
  return {
    // With quote-aware intrabar data the trigger price is already the executable
    // bid/ask side, so applying spread again would double-count it.
    price: gapReference + direction * (quoteAware ? slippage : spread / 2 + slippage),
    referencePrice: gapReference,
    reason,
    intrabarAmbiguous: stop && target,
    gapThrough,
  };
}
