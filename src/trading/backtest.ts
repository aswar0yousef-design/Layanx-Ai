import type {Candle,TradingSignal,TradingStrategy} from "./strategy.js";
export interface BacktestTrade{entryTime:number;exitTime:number;side:"long"|"short";entry:number;exit:number;stopLoss:number;takeProfit:number;pnl:number;reason:string[];barsHeld:number;}
export interface BacktestCosts{spread?:number;slippage?:number;commissionPerUnit?:number;}
export interface BacktestResult{strategyId:string;trades:BacktestTrade[];startingEquity:number;endingEquity:number;returnPct:number;winRate:number;profitFactor:number;maxDrawdownPct:number;expectancy:number;averageBarsHeld:number;costs:BacktestCosts;}
export function backtest(strategy:TradingStrategy,candles:Candle[],startingEquity=100000,riskFraction=0.002,costs:BacktestCosts={}):BacktestResult{
 if(candles.length<40)throw new Error("At least 40 candles are required for backtesting.");
 if(startingEquity<=0||riskFraction<=0||riskFraction>=0.1)throw new Error("Invalid backtest risk configuration.");
 const spread=Math.max(0,costs.spread??0),slippage=Math.max(0,costs.slippage??0),commission=Math.max(0,costs.commissionPerUnit??0);
 let equity=startingEquity,peak=equity,maxDrawdown=0;const trades:BacktestTrade[]=[];let open:TradingSignal|null=null;let openIndex=-1;
 for(let i=30;i<candles.length;i++){const c=candles[i];if(c===undefined)continue;
  if(open){const hitStop=open.side==="long"?c.low<=open.stopLoss:c.high>=open.stopLoss;const hitTarget=open.side==="long"?c.high>=open.takeProfit:c.low<=open.takeProfit;
   if(hitStop||hitTarget){const exit=hitStop?open.stopLoss:open.takeProfit;const risk=Math.abs(open.entry-open.stopLoss);if(risk<=0){open=null;openIndex=-1;continue;}
    const reward=open.side==="long"?exit-open.entry:open.entry-exit;const qty=equity*riskFraction/risk;const cost=(spread+slippage+commission)*qty;const pnl=reward*qty-cost;equity+=pnl;
    trades.push({entryTime:open.timestamp,exitTime:c.timestamp,side:open.side,entry:open.entry,exit,stopLoss:open.stopLoss,takeProfit:open.takeProfit,pnl,reason:open.reason,barsHeld:i-openIndex});
    open=null;openIndex=-1;peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,(peak-equity)/peak);continue;}}
  if(!open){const signal=strategy.evaluate({candles,index:i});if(signal){open=signal;openIndex=i;}}
 }
 const wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0);const grossProfit=wins.reduce((s,t)=>s+t.pnl,0),grossLoss=Math.abs(losses.reduce((s,t)=>s+t.pnl,0));
 return{strategyId:strategy.id,trades,startingEquity,endingEquity:equity,returnPct:(equity/startingEquity-1)*100,winRate:trades.length?wins.length/trades.length:0,profitFactor:grossLoss?grossProfit/grossLoss:grossProfit>0?Infinity:0,maxDrawdownPct:maxDrawdown*100,expectancy:trades.length?trades.reduce((s,t)=>s+t.pnl,0)/trades.length:0,averageBarsHeld:trades.length?trades.reduce((s,t)=>s+t.barsHeld,0)/trades.length:0,costs:{spread,slippage,commissionPerUnit:commission}};
}
