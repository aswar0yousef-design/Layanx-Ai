import {backtest,type BacktestResult,type BacktestCosts} from "./backtest.js";import type {Candle,TradingStrategy} from "./strategy.js";

export interface StrategyCandidate{strategy:TradingStrategy;parameters:Record<string,number>;result:BacktestResult;}
export interface WalkForwardWindow{trainStart:number;trainEnd:number;testStart:number;testEnd:number;}
export interface WalkForwardResult{windows:WalkForwardWindow[];results:BacktestResult[];combinedReturnPct:number;combinedMaxDrawdownPct:number;}
export interface MonteCarloResult{runs:number;meanReturnPct:number;p05ReturnPct:number;medianReturnPct:number;p95ReturnPct:number;worstDrawdownPct:number;bestDrawdownPct:number;}

export function optimizeStrategy(candles:Candle[],factory:(parameters:Record<string,number>)=>TradingStrategy,grid:Record<string,number[]>,startingEquity=100000,riskFraction=0.002,costs:BacktestCosts={}):StrategyCandidate[]{
 const keys=Object.keys(grid);const combinations:Record<string,number>[]=[];
 const build=(i:number,current:Record<string,number>)=>{if(i===keys.length){combinations.push({...current});return;}for(const value of grid[keys[i]]??[]){current[keys[i]]=value;build(i+1,current);}};
 build(0,{});
 return combinations.map(parameters=>{const strategy=factory(parameters);return{strategy,parameters,result:backtest(strategy,candles,startingEquity,riskFraction,costs);}}).sort((a,b)=>b.result.expectancy-a.result.expectancy);
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
 for(let r=0;r<runs;r++){let equity=100000,peak=equity,maxDd=0;for(let i=0;i<base.length;i++){const index=Math.floor(Math.random()*base.length);equity+=base[index];peak=Math.max(peak,equity);maxDd=Math.max(maxDd,(peak-equity)/peak*100);}returns.push((equity/100000-1)*100);drawdowns.push(maxDd);}
 returns.sort((a,b)=>a-b);drawdowns.sort((a,b)=>a-b);const q=(values:number[],p:number)=>values[Math.min(values.length-1,Math.floor((values.length-1)*p))];
 return{runs,meanReturnPct:returns.reduce((s,v)=>s+v,0)/returns.length,p05ReturnPct:q(returns,.05),medianReturnPct:q(returns,.5),p95ReturnPct:q(returns,.95),worstDrawdownPct:drawdowns[drawdowns.length-1]??0,bestDrawdownPct:drawdowns[0]??0};
}
