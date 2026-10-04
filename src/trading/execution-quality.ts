import {roundDecimal} from "./numeric.js";

export type TradeSide = "long" | "short";

export interface ExecutionTrade {
  id: string;
  symbol: string;
  side: TradeSide;
  quantity: number;
  pointValue?: number;
  entry: { fillPrice: number; referencePrice?: number; spread?: number; atr?: number; slippage?: number };
  exit: { fillPrice: number; referencePrice?: number; spread?: number; slippage?: number };
  grossPnl?: number;
}

export type ExecutionQuality = "excellent" | "good" | "marginal" | "poor" | "unknown";

export interface ExecutionQualityResult {
  tradeId: string; symbol: string; side: TradeSide;
  spreadEntry?: number; spreadExit?: number; spreadAtrRatio?: number; atr?: number;
  entrySlippage?: number; exitSlippage?: number; entrySlippageAtrRatio?: number; exitSlippageAtrRatio?: number; totalExecutionDrag?: number;
  estimatedRoundTripCost?: number; grossPnl: number; netPnlAfterExecutionCosts: number;
  executionCostPctOfGross: number | null; quality: ExecutionQuality; warnings: string[]; atrBasis?: "ohlc";
}

function finite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function abs(value: number | undefined): number | undefined { return finite(value) ? Math.abs(value) : undefined; }
function sideSign(side: TradeSide): number { return side === "long" ? 1 : -1; }

export function analyzeExecutionQuality(trade: ExecutionTrade): ExecutionQualityResult {
  const sign = sideSign(trade.side);
  const entryRef = finite(trade.entry.referencePrice) ? trade.entry.referencePrice : trade.entry.fillPrice;
  const exitRef = finite(trade.exit.referencePrice) ? trade.exit.referencePrice : trade.exit.fillPrice;
  const multiplier = finite(trade.pointValue) ? trade.pointValue : 1;
  const grossPnl = finite(trade.grossPnl)
    ? trade.grossPnl
    : sign * (exitRef - entryRef) * trade.quantity * multiplier;

  const entrySpread = abs(trade.entry.spread);
  const exitSpread = abs(trade.exit.spread);
  const atr = abs(trade.entry.atr);
  const spreadAtrRatio = finite(entrySpread) && finite(atr) && atr > 0 ? entrySpread / atr : undefined;

  const entrySlip = abs(trade.entry.slippage);
  const exitSlip = abs(trade.exit.slippage);
  const entrySlippageAtrRatio = entrySlip !== undefined && atr !== undefined && atr > 0 ? entrySlip / atr : undefined;
  const exitSlippageAtrRatio = exitSlip !== undefined && atr !== undefined && atr > 0 ? exitSlip / atr : undefined;
  const entryDrag = finite(trade.entry.referencePrice)
    ? Math.abs(trade.entry.fillPrice - entryRef)
    : (entrySpread !== undefined ? entrySpread / 2 : 0);
  const exitDrag = finite(trade.exit.referencePrice)
    ? Math.abs(trade.exit.fillPrice - exitRef)
    : (exitSpread !== undefined ? exitSpread / 2 : 0);
  const totalExecutionDrag = (entryDrag + exitDrag) * trade.quantity * multiplier;
  const netPnlAfterExecutionCosts = roundDecimal(grossPnl - totalExecutionDrag);
  const executionCostPctOfGross = grossPnl > 0 ? roundDecimal((totalExecutionDrag / grossPnl) * 100) : null;

  let quality: ExecutionQuality = "unknown";
  if (spreadAtrRatio !== undefined) {
    if (spreadAtrRatio <= 0.10) quality = "excellent";
    else if (spreadAtrRatio <= 0.20) quality = "good";
    else if (spreadAtrRatio <= 0.35) quality = "marginal";
    else quality = "poor";
  }

  const warnings: string[] = [];
  if (atr === undefined || atr <= 0) warnings.push("ATR is missing or non-positive.");
  if (entrySpread === undefined) warnings.push("Entry spread is missing.");
  if (spreadAtrRatio !== undefined && spreadAtrRatio > 0.35) warnings.push("Spread consumes a large share of entry ATR.");
  if (grossPnl > 0 && netPnlAfterExecutionCosts <= 0) warnings.push("Nominally profitable trade is not profitable after estimated execution costs.");
  if (entrySlip !== undefined && atr !== undefined && atr > 0 && entrySlip / atr > 0.10) warnings.push("Entry slippage exceeds 10% of ATR.");
  if (exitSlip !== undefined && atr !== undefined && atr > 0 && exitSlip / atr > 0.10) warnings.push("Exit slippage exceeds 10% of ATR.");

  return {
    tradeId: trade.id, symbol: trade.symbol, side: trade.side, spreadEntry: entrySpread,
    spreadExit: exitSpread, spreadAtrRatio, atr, entrySlippage: entrySlip, exitSlippage: exitSlip,
    entrySlippageAtrRatio, exitSlippageAtrRatio, totalExecutionDrag, estimatedRoundTripCost: totalExecutionDrag, grossPnl, atrBasis: atr !== undefined ? "ohlc" : undefined,
    netPnlAfterExecutionCosts, executionCostPctOfGross, quality, warnings
  };
}

export function summarizeExecutionQuality(results: ExecutionQualityResult[]) {
  const valid = results.filter(r => r.quality !== "unknown");
  const grossPnl = results.reduce((sum, r) => sum + r.grossPnl, 0);
  const netPnl = results.reduce((sum, r) => sum + r.netPnlAfterExecutionCosts, 0);
  const totalCosts = results.reduce((sum, r) => sum + (r.estimatedRoundTripCost ?? 0), 0);
  const avgSpreadAtrRatio = valid.length
    ? valid.reduce((sum, r) => sum + (r.spreadAtrRatio ?? 0), 0) / valid.length
    : null;
  const costErasedTrades = results.filter(r => r.grossPnl > 0 && r.netPnlAfterExecutionCosts <= 0).length;
  return { trades: results.length, analyzedTrades: valid.length, grossPnl, executionCosts: totalCosts,
    netPnlAfterExecutionCosts: netPnl, avgSpreadAtrRatio, costErasedTrades };
}
