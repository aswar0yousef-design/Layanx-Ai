import type { TradeSide } from "./execution-quality.js";
import type { MarketCandle } from "./scalping-signal.js";

export type IntrabarResolution = "conservative" | "optimistic" | "open-first";

export interface ExitSimulation {
  price: number;
  referencePrice: number;
  reason: "stop-loss" | "take-profit" | "trailing-stop";
  intrabarAmbiguous: boolean;
  gapThrough: boolean;
}

function touched(trade: { side: TradeSide; stopLossPrice: number; takeProfitPrice?: number }, candle: MarketCandle) {
  const stop = trade.side === "long"
    ? candle.low <= trade.stopLossPrice
    : candle.high >= trade.stopLossPrice;
  const target = trade.takeProfitPrice !== undefined && (
    trade.side === "long"
      ? candle.high >= trade.takeProfitPrice
      : candle.low <= trade.takeProfitPrice
  );
  return { stop, target };
}

export function simulateExit(
  trade: { side: TradeSide; stopLossPrice: number; takeProfitPrice?: number },
  candle: MarketCandle,
  spread: number,
  slippage: number,
  resolution: IntrabarResolution = "conservative",
): ExitSimulation | null {
  const { stop, target } = touched(trade, candle);
  if (!stop && !target) return null;

  const stopGap = trade.side === "long"
    ? candle.open <= trade.stopLossPrice
    : candle.open >= trade.stopLossPrice;
  const targetGap = trade.takeProfitPrice !== undefined && (
    trade.side === "long"
      ? candle.open >= trade.takeProfitPrice
      : candle.open <= trade.takeProfitPrice
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
    price: gapReference + direction * (spread / 2 + slippage),
    referencePrice: gapReference,
    reason,
    intrabarAmbiguous: stop && target,
    gapThrough,
  };
}
