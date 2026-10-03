import {readFile} from "node:fs/promises";
import {parseMarketCsv,sortMarketBars,validateMarketData,type MarketBar} from "../src/trading/market-data.js";
import {ScalpingSweepStrategy} from "../src/trading/strategy.js";
import {optimizeStrategy,walkForward,monteCarlo,analyzeTrades,analyzeTradesByRegime} from "../src/trading/evaluation.js";

type Session="all"|"asia"|"london"|"new-york";
const args=process.argv.slice(2);const file=args.find(a=>!a.startsWith("--"));if(!file)throw new Error("Usage: npm run trading:evaluate -- <XAUUSD.csv> [--spread=0.20] [--slippage=0.05] [--commission=0] [--session=all|asia|london|new-york]");
const flag=(name:string,fallback:number)=>{const raw=args.find(a=>a.startsWith("--"+name+"="))?.split("=")[1];if(raw===undefined)return fallback;const value=Number(raw);if(!Number.isFinite(value)||value<0)throw new Error("Invalid --"+name+" value.");return value;};
const session=(args.find(a=>a.startsWith("--session="))?.split("=")[1]??"all") as Session;
if(!["all","asia","london","new-york"].includes(session))throw new Error("Invalid --session. Use all, asia, london, or new-york.");
const csv=await readFile(file,"utf8");const parsedBars=parseMarketCsv(csv);if(parsedBars.length<120)throw new Error("At least 120 bars are required for evaluation.");
const quality=validateMarketData(parsedBars);const rawBars=sortMarketBars(parsedBars);if(!quality.valid)throw new Error("Market data quality failed: "+JSON.stringify(quality));

function sessionHour(timestamp:number):number{return new Date(timestamp).getUTCHours()+new Date(timestamp).getUTCMinutes()/60;}
function inSession(bar:MarketBar):boolean{const hour=sessionHour(bar.timestamp);if(session==="all")return true;if(session==="asia")return hour>=0&&hour<8;if(session==="london")return hour>=7&&hour<16;return hour>=12&&hour<21;}
const entryFilter=(bar:MarketBar)=>inSession(bar);const bars=rawBars;if(bars.length<120)throw new Error("Selected session has fewer than 120 bars.");
const costs={spread:flag("spread",0),slippage:flag("slippage",0),commissionPerUnit:flag("commission",0)};
const factory=(p:Record<string,number>)=>new ScalpingSweepStrategy(p);
const grid={lookback:[5,8,10,12,15],displacement:[.5,.6,.7],rewardMultiple:[.6,.8,1]};
const optimized=optimizeStrategy(bars,factory,grid,100000,.001,costs,entryFilter);
const trainBars=Math.min(5000,Math.max(1000,Math.floor(bars.length*.5))),testBars=Math.min(1000,Math.max(250,Math.floor(bars.length*.1)));
const wf=walkForward(bars,factory,grid,trainBars,testBars,100000,.001,costs,entryFilter);
const best=optimized[0]?.result??null;const trades=best?.trades??[];const mc=trades.length?monteCarlo(trades,2000):null;const overall=analyzeTrades(trades);const regime=analyzeTradesByRegime(trades,bars);
const side=(name:"long"|"short")=>{const t=trades.filter(x=>x.side===name);const pnl=t.reduce((s,x)=>s+x.pnl,0);return{...analyzeTrades(t),pnl};};
console.log(JSON.stringify({symbol:"XAUUSD",session,bars:bars.length,entryEligibleBars:bars.filter(entryFilter).length,rawBars:rawBars.length,from:new Date(bars[0]!.timestamp).toISOString(),to:new Date(bars[bars.length-1]!.timestamp).toISOString(),quality,costs,overall,regime,best:optimized[0]?{parameters:optimized[0].parameters,result:optimized[0].result}:null,long:side("long"),short:side("short"),walkForward:{trainBars,testBars,windows:wf.windows.length,returnPct:wf.combinedReturnPct,maxDrawdownPct:wf.combinedMaxDrawdownPct},monteCarlo:mc},null,2));
