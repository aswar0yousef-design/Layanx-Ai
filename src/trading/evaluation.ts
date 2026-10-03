import {backtest,type BacktestResult,type BacktestCosts} from "./backtest.js";import type {Candle,TradingStrategy} from "./strategy.js";

export interface StrategyCandidate{strategy:TradingStrategy;parameters:Record<string,number>;result:BacktestResult;}
export interface WalkForwardWindow{trainStart:number;trainEnd:number;testStart:number;testEnd:number;}
export interface WalkForwardResult{windows:WalkForwardWindow[];results:BacktestResult[];combinedReturnPct:number;combinedMaxDrawdownPct:number;}
export interface MonteCarloResult{runs:number;meanReturnPct:number;p05ReturnPct:number;medianReturnPct:number;p95ReturnPct:number;worstDrawdownPct:number;bestDrawdownPct:number;}
export interface TradeAnalysis{trades:number;wins:number;losses:number;pnl:number;winRate:number;averagePnl:number;averageBarsHeld:number;maxConsecutiveLosses:number;grossProfit:number;grossLoss:number;profitFactor:number;}
export function analyzeTrades(trades:BacktestResult["trades"]):TradeAnalysis{
 let losses=0,maxConsecutiveLosses=0;const wins=trades.filter(t=>t.pnl>0),losing=trades.filter(t=>t.pnl<0);
 for(const trade of trades){if(trade.pnl<0){losses++;maxConsecutiveLosses=Math.max(maxConsecutiveLosses,losses);}else if(trade.pnl>0)losses=0;}
 const pnl=trades.reduce((s,t)=>s+t.pnl,0),grossProfit=wins.reduce((s,t)=>s+t.pnl,0),grossLoss=Math.abs(losing.reduce((s,t)=>s+t.pnl,0));
 return{trades:trades.length,wins:wins.length,losses:losing.length,pnl,winRate:trades.length?wins.length/trades.length:0,averagePnl:trades.length?pnl/trades.length:0,averageBarsHeld:trades.length?trades.reduce((s,t)=>s+t.barsHeld,0)/trades.length:0,maxConsecutiveLosses,grossProfit,grossLoss,profitFactor:grossLoss?grossProfit/grossLoss:grossProfit>0?Infinity:0};
}

export function optimizeStrategy(candles:Candle[],factory:(parameters:Record<string,number>)=>TradingStrategy,grid:Record<string,number[]>,startingEquity=100000,riskFraction=0.002,costs:BacktestCosts={}):StrategyCandidate[]{
 const keys=Object.keys(grid);const combinations:Record<string,number>[]=[];
 const build=(i:number,current:Record<string,number>)=>{if(i===keys.length){combinations.push({...current});return;}const key=keys[i];if(key===undefined)throw new Error("Invalid optimization key.");for(const value of grid[key]??[]){current[key]=value;build(i+1,current);}};
 build(0,{});
 return combinations.map(parameters=>{const strategy=factory(parameters);return{strategy,parameters,result:backtest(strategy,candles,startingEquity,riskFraction,costs)}}).sort((a,b)=>b.result.expectancy-a.result.expectancy);
}

export function walkForward(candles:Candle[],factory:(parameters:Record<string,number>)=>TradingStrategy,grid:Record<string,number[]>,trainBars:number,testBars:number,startingEquity=100000,riskFraction=0.002,costs:BacktestCosts={}):WalkForwardResult{
 if(trainBars<40||testBars<1)throw new Error("Invalid walk-forward window.");
 const windows:WalkForwardWindow[]=[];const results:BacktestResult[]=[];
 for(let trainStart=0;trainStart+trainBars+testBars<=candles.length;trainStart+=testBars){
  const train=candles.slice(trainStart,trainStart+trainBars),test=candles.slice(trainStart+trainBars,trainStart+trainBars+testBars);
  const candidates=optimizeStrategy(train,factory,grid,startingEquity,riskFraction,costs);const best=candidates[0];if(!best)continue;
  const result=backtest(best.strategy,test,startingEquity,riskFraction,costs);
  windows.push({trainStart,trainEnd:trainStart+trainBars,testStart:trainStart+trainBars,testEnd:trainStart+trainBars+testBars});results.push(result);
 }
 const ending=results.reduce((equity,result)=>equity*(1+result.returnPct/100),startingEquity);
 return{windows,results,combinedReturnPct:(ending/startingEquity-1)*100,combinedMaxDrawdownPct:results.reduce((max,result)=>Math.max(max,result.maxDrawdownPct),0)};
}

export function monteCarlo(trades:{pnl:number}[],runs=1000):MonteCarloResult{
 if(!trades.length)throw new Error("Monte Carlo requires at least one trade.");runs=Math.min(Math.max(Math.floor(runs),100),10000);
 const base=trades.map(t=>t.pnl),returns:number[]=[];const drawdowns:number[]=[];
 for(let r=0;r<runs;r++){let equity=100000,peak=equity,maxDd=0;for(let i=0;i<base.length;i++){const index=Math.floor(Math.random()*base.length);const pnl=base[index];if(pnl===undefined)continue;equity+=pnl;peak=Math.max(peak,equity);maxDd=Math.max(maxDd,(peak-equity)/peak*100);}returns.push((equity/100000-1)*100);drawdowns.push(maxDd);}
 returns.sort((a,b)=>a-b);drawdowns.sort((a,b)=>a-b);const q=(values:number[],p:number)=>values.length?values[Math.min(values.length-1,Math.floor((values.length-1)*p))]??0:0;
 const mean=returns.length?returns.reduce((s,v)=>s+v,0)/returns.length:0;const worst=drawdowns.length?drawdowns[drawdowns.length-1]??0:0;const best=drawdowns.length?drawdowns[0]??0:0;return{runs,meanReturnPct:mean,p05ReturnPct:q(returns,.05),medianReturnPct:q(returns,.5),p95ReturnPct:q(returns,.95),worstDrawdownPct:worst,bestDrawdownPct:best};
}
