import type { TradeAnalysis } from "./trade-record.js";
import {roundDecimal} from "./numeric.js";

export interface BacktestReport {initialBalance:number;finalBalance:number;netPnl:number;returnPct:number;trades:number;wins:number;losses:number;winRate:number;grossProfit:number;grossLoss:number;profitFactor:number;expectancyPerTrade:number;maxDrawdown:number;maxDrawdownPct:number;estimatedRoundTripCosts:number;executionCosts:number;commissions:number;swaps:number;costErasedTrades:number;intrabarAmbiguousExits:number;gapThroughExits:number;}
export interface PooledBacktestReport {aggregation:"pooled-trade-results";trades:number;wins:number;losses:number;winRate:number;netPnl:number;grossProfit:number;grossLoss:number;profitFactor:number;expectancyPerTrade:number;estimatedRoundTripCosts:number;executionCosts:number;commissions:number;swaps:number;costErasedTrades:number;intrabarAmbiguousExits:number;gapThroughExits:number;}

export function buildPooledBacktestReport(analyses:TradeAnalysis[]):PooledBacktestReport{
 let wins=0,grossProfit=0,grossLoss=0,estimatedRoundTripCosts=0,executionCosts=0,commissions=0,swaps=0,costErasedTrades=0,intrabarAmbiguousExits=0,gapThroughExits=0;
 for(const analysis of analyses){
  if(analysis.trueNetPnl>0){wins++;grossProfit+=analysis.trueNetPnl;}else if(analysis.trueNetPnl<0)grossLoss+=Math.abs(analysis.trueNetPnl);
  estimatedRoundTripCosts+=analysis.estimatedRoundTripCost??0;executionCosts+=analysis.executionCost??0;commissions+=analysis.commission;swaps+=analysis.swap;
  if(analysis.grossPnl>0&&analysis.trueNetPnl<=0)costErasedTrades++;
  if(analysis.metadata?.intrabarAmbiguous===true)intrabarAmbiguousExits++;
  if(analysis.metadata?.gapThrough===true)gapThroughExits++;
 }
 const trades=analyses.length,netPnl=analyses.reduce((sum,a)=>sum+a.trueNetPnl,0),grossLossValue=grossLoss;
 return{aggregation:"pooled-trade-results",trades,wins,losses:trades-wins,winRate:trades===0?0:roundDecimal(wins/trades*100),netPnl:roundDecimal(netPnl),grossProfit:roundDecimal(grossProfit),grossLoss:roundDecimal(grossLossValue),profitFactor:grossLossValue===0?(grossProfit>0?Infinity:0):roundDecimal(grossProfit/grossLossValue),expectancyPerTrade:trades===0?0:roundDecimal(netPnl/trades),estimatedRoundTripCosts:roundDecimal(estimatedRoundTripCosts),executionCosts:roundDecimal(executionCosts),commissions:roundDecimal(commissions),swaps:roundDecimal(swaps),costErasedTrades,intrabarAmbiguousExits,gapThroughExits};
}
export function buildBacktestReport(initialBalance:number,analyses:TradeAnalysis[]):BacktestReport{
 if(initialBalance<=0)throw new Error("Initial balance must be positive.");
 let balance=initialBalance,peak=initialBalance,maxDrawdown=0,maxDrawdownPct=0,grossProfit=0,grossLoss=0,estimatedRoundTripCosts=0,executionCosts=0,commissions=0,swaps=0,costErasedTrades=0,wins=0,intrabarAmbiguousExits=0,gapThroughExits=0;
 for(const analysis of analyses){
  balance+=analysis.trueNetPnl;peak=Math.max(peak,balance);const drawdown=peak-balance;maxDrawdown=Math.max(maxDrawdown,drawdown);if(peak>0)maxDrawdownPct=Math.max(maxDrawdownPct,drawdown/peak*100);
  if(analysis.trueNetPnl>0){wins++;grossProfit+=analysis.trueNetPnl;}else if(analysis.trueNetPnl<0)grossLoss+=Math.abs(analysis.trueNetPnl);
  estimatedRoundTripCosts+=analysis.estimatedRoundTripCost??0;executionCosts+=analysis.executionCost??0;commissions+=analysis.commission;swaps+=analysis.swap;
  if(analysis.grossPnl>0&&analysis.trueNetPnl<=0)costErasedTrades++;
  if(analysis.metadata?.intrabarAmbiguous===true)intrabarAmbiguousExits++;
  if(analysis.metadata?.gapThrough===true)gapThroughExits++;
 }
 const trades=analyses.length,losses=trades-wins,netPnl=roundDecimal(balance-initialBalance),finalBalance=roundDecimal(balance),grossLossValue=roundDecimal(grossLoss),grossProfitValue=roundDecimal(grossProfit);
 return{initialBalance,finalBalance,netPnl,returnPct:roundDecimal(netPnl/initialBalance*100),trades,wins,losses,winRate:trades===0?0:roundDecimal(wins/trades*100),grossProfit:grossProfitValue,grossLoss:grossLossValue,profitFactor:grossLossValue===0?(grossProfitValue>0?Infinity:0):roundDecimal(grossProfitValue/grossLossValue),expectancyPerTrade:trades===0?0:roundDecimal(netPnl/trades),maxDrawdown:roundDecimal(maxDrawdown),maxDrawdownPct:roundDecimal(maxDrawdownPct),estimatedRoundTripCosts:roundDecimal(estimatedRoundTripCosts),executionCosts:roundDecimal(executionCosts),commissions:roundDecimal(commissions),swaps:roundDecimal(swaps),costErasedTrades,intrabarAmbiguousExits,gapThroughExits};
}
