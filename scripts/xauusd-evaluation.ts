import {readFile} from "node:fs/promises";
import {parseMarketCsv,sortMarketBars} from "../src/trading/market-data.js";
import {ScalpingSweepStrategy} from "../src/trading/strategy.js";
import {optimizeStrategy,walkForward,monteCarlo} from "../src/trading/evaluation.js";

const file=process.argv[2];if(!file)throw new Error("Usage: npm run trading:evaluate -- <XAUUSD.csv>");
const csv=await readFile(file,"utf8");const bars=sortMarketBars(parseMarketCsv(csv));if(bars.length<120)throw new Error("At least 120 bars are required for evaluation.");
const costs={spread:0,slippage:0,commissionPerUnit:0};
const factory=(p:Record<string,number>)=>new ScalpingSweepStrategy(p);
const grid={lookback:[5,8,10,12,15],displacement:[.5,.6,.7],rewardMultiple:[.6,.8,1]};
const optimized=optimizeStrategy(bars,factory,grid,100000,.001,costs);
const wf=walkForward(bars,factory,grid,Math.min(5000,Math.max(1000,Math.floor(bars.length*.5))),Math.min(1000,Math.max(250,Math.floor(bars.length*.1))),100000,.001,costs);
const trades=optimized[0]?.result.trades??[];
const mc=trades.length?monteCarlo(trades,2000):null;
console.log(JSON.stringify({symbol:"XAUUSD",bars:bars.length,from:new Date(bars[0]!.timestamp).toISOString(),to:new Date(bars[bars.length-1]!.timestamp).toISOString(),best:optimized[0]?{parameters:optimized[0].parameters,result:optimized[0].result}:null,walkForward:{windows:wf.windows.length,returnPct:wf.combinedReturnPct,maxDrawdownPct:wf.combinedMaxDrawdownPct},monteCarlo:mc},null,2));
