import type {Candle,TradingSignal,TradingStrategy} from "./strategy.js";
export interface BacktestTrade{entryTime:number;exitTime:number;side:"long"|"short";entry:number;exit:number;stopLoss:number;takeProfit:number;pnl:number;reason:string[];}
export interface BacktestResult{strategyId:string;trades:BacktestTrade[];startingEquity:number;endingEquity:number;returnPct:number;winRate:number;profitFactor:number;maxDrawdownPct:number;expectancy:number;}
export function backtest(strategy:TradingStrategy,candles:Candle[],startingEquity=100000,riskFraction=0.005):BacktestResult{
 if(candles.length<40)throw new Error("At least 40 candles are required for backtesting.");if(startingEquity<=0||riskFraction<=0||riskFraction>=0.1)throw new Error("Invalid backtest risk configuration.");
 let equity=startingEquity,peak=equity,maxDrawdown=0;const trades:BacktestTrade[]=[];let open:TradingSignal|null=null;
 for(let i=30;i<candles.length;i++){
  const c=candles[i];
  if(open){const hitStop=open.side==="long"?c.low<=open.stopLoss:c.high>=open.stopLoss;const hitTarget=open.side==="long"?c.high>=open.takeProfit:c.low<=open.takeProfit;if(hitStop||hitTarget){const exit=hitStop?open.stopLoss:open.takeProfit;const risk=Math.abs(open.entry-open.stopLoss);const reward= open.side==="long"?exit-open.entry:open.entry-exit;const pnl=(reward/risk)*(equity*riskFraction);equity+=pnl;trades.push({entryTime:open.timestamp,exitTime:c.timestamp,side:open.side,entry:open.entry,exit,stopLoss:open.stopLoss,takeProfit:open.takeProfit,pnl,reason:open.reason});open=null;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak);continue;}}
  if(!open){const signal=strategy.evaluate({candles,index:i});if(signal)open=signal;}
 }
 const wins=trades.filter(t=>t.pnl>0);const grossProfit=wins.reduce((s,t)=>s+t.pnl,0);const grossLoss=Math.abs(trades.filter(t=>t.pnl<0).reduce((s,t)=>s+t.pnl,0));const returnPct=(equity/startingEquity-1)*100;return{strategyId:strategy.id,trades,startingEquity,endingEquity:equity,returnPct,winRate:trades.length?wins.length/trades.length:0,profitFactor:grossLoss?grossProfit/grossLoss:grossProfit>0?Infinity:0,maxDrawdownPct:maxDrawdown*100,expectancy:trades.length?trades.reduce((s,t)=>s+t.pnl,0)/trades.length:0};
}
