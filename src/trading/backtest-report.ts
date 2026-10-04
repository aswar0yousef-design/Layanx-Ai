import type { TradeAnalysis } from "./trade-record.js";

export interface BacktestReport {
  initialBalance: number;
  finalBalance: number;
  netPnl: number;
  returnPct: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  expectancyPerTrade: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  estimatedRoundTripCosts: number;
  commissions: number;
  swaps: number;
  costErasedTrades: number;
  intrabarAmbiguousExits: number;
  gapThroughExits: number;
}


export interface PooledBacktestReport {
  aggregation: "pooled-trade-results";
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  expectancyPerTrade: number;
  estimatedRoundTripCosts: number;
  commissions: number;
  swaps: number;
  costErasedTrades: number;
  intrabarAmbiguousExits: number;
  gapThroughExits: number;
}

export function buildPooledBacktestReport(analyses: TradeAnalysis[]): PooledBacktestReport {
  let wins = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let estimatedRoundTripCosts = 0;
  let commissions = 0;
  let swaps = 0;
  let costErasedTrades = 0;
  let intrabarAmbiguousExits = 0;
  let gapThroughExits = 0;

  for (const analysis of analyses) {
    if (analysis.trueNetPnl > 0) {
      wins += 1;
      grossProfit += analysis.trueNetPnl;
    } else if (analysis.trueNetPnl < 0) {
      grossLoss += Math.abs(analysis.trueNetPnl);
    }
    estimatedRoundTripCosts += analysis.estimatedRoundTripCost ?? 0;
    commissions += analysis.commission;
    swaps += analysis.swap;
    if (analysis.grossPnl > 0 && analysis.trueNetPnl <= 0) costErasedTrades += 1;
    if (analysis.metadata?.intrabarAmbiguous === true) intrabarAmbiguousExits += 1;
    if (analysis.metadata?.gapThrough === true) gapThroughExits += 1;
  }

  const trades = analyses.length;
  const netPnl = analyses.reduce((sum, analysis) => sum + analysis.trueNetPnl, 0);
  const grossLossValue = grossLoss;

  return {
    aggregation: "pooled-trade-results",
    trades,
    wins,
    losses: trades - wins,
    winRate: trades === 0 ? 0 : (wins / trades) * 100,
    netPnl,
    grossProfit,
    grossLoss: grossLossValue,
    profitFactor: grossLossValue === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLossValue,
    expectancyPerTrade: trades === 0 ? 0 : netPnl / trades,
    estimatedRoundTripCosts,
    commissions,
    swaps,
    costErasedTrades,
    intrabarAmbiguousExits,
    gapThroughExits,
  };
}

export function buildBacktestReport(
  initialBalance: number,
  analyses: TradeAnalysis[],
): BacktestReport {
  if (initialBalance <= 0) throw new Error("Initial balance must be positive.");

  let balance = initialBalance;
  let peak = initialBalance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let grossProfit = 0;
  let grossLoss = 0;
  let estimatedRoundTripCosts = 0;
  let commissions = 0;
  let swaps = 0;
  let costErasedTrades = 0;
  let wins = 0;
  let intrabarAmbiguousExits = 0;
  let gapThroughExits = 0;

  for (const analysis of analyses) {
    balance += analysis.trueNetPnl;
    peak = Math.max(peak, balance);

    const drawdown = peak - balance;
    maxDrawdown = Math.max(maxDrawdown, Number(drawdown.toFixed(12)));
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, Number(((drawdown / peak) * 100).toFixed(12)));

    if (analysis.trueNetPnl > 0) {
      wins += 1;
      grossProfit += analysis.trueNetPnl;
    } else if (analysis.trueNetPnl < 0) {
      grossLoss += Math.abs(analysis.trueNetPnl);
    }

    estimatedRoundTripCosts += analysis.estimatedRoundTripCost ?? 0;
    commissions += analysis.commission;
    swaps += analysis.swap;
    if (analysis.grossPnl > 0 && analysis.trueNetPnl <= 0) costErasedTrades += 1;
    if (analysis.metadata?.intrabarAmbiguous === true) intrabarAmbiguousExits += 1;
    if (analysis.metadata?.gapThrough === true) gapThroughExits += 1;
  }

  const trades = analyses.length;
  const losses = trades - wins;
  const netPnl = Number((balance - initialBalance).toFixed(12));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Infinity : 0) : grossProfit / grossLoss;

  return {
    initialBalance,
    finalBalance: balance,
    netPnl,
    returnPct: Number(((netPnl / initialBalance) * 100).toFixed(12)),
    trades,
    wins,
    losses,
    winRate: trades === 0 ? 0 : (wins / trades) * 100,
    grossProfit,
    grossLoss,
    profitFactor,
    expectancyPerTrade: trades === 0 ? 0 : netPnl / trades,
    maxDrawdown,
    maxDrawdownPct,
    estimatedRoundTripCosts,
    commissions,
    swaps,
    costErasedTrades,
    intrabarAmbiguousExits,
    gapThroughExits,
  };
}
