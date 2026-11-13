/**
 * Each market with its own profile (src/trading/asset-profiles.ts: its timeframes, its strategies, its trading hours), on
 * real history from the MT5 demo account; writes the strategy book that switches on only those that clear KEEP_RULE on both
 * halves (3 of 4 quarters, and with a 1.5x spread).
 *
 *   npx tsx scripts/strategy-backtest.ts [--symbols XAUUSD,EURUSD,...] [--timeframes M15,H1] [--write-book]
 */
import fs from "node:fs";
import path from "node:path";
import {resolveDataPaths} from "../src/platform/paths.js";
import {buildContext} from "../src/trading/strategies.js";
import {PROFILES,assetClassOf} from "../src/trading/asset-profiles.js";
import {verdict,KEEP_RULE} from "../src/trading/strategy-backtest.js";
import {SCALPING_TIMEFRAMES,loadStrategyBook,saveStrategyBook,scalpingAllowed,type StrategyBookEntry} from "../src/trading/strategy-book.js";

const arg=(n:string)=>{const i=process.argv.indexOf("--"+n);return i>=0?process.argv[i+1]:undefined;};
const symbols=(arg("symbols")??"XAUUSD,XAGUSD,EURUSD,GBPUSD,USDJPY,WTI,BRENT,BTCUSD,ETHUSD,AAPL.US,NVDA.US,META.US,TSLA.OQ,AMZN.OQ,GOOGL.OQ,US500_SPOT,US100_Spot").split(",");
// Scalping timeframes (M1, M5) are measured only when the owner turned scalping back on (MT5_ALLOW_SCALPING=on).
const allowedTf=(tf:string)=>!SCALPING_TIMEFRAMES.includes(tf)||scalpingAllowed();
const MINUTES:Record<string,number>={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240};
const {Mt5LiveAdapter}=await import("../src/trading/mt5-live-adapter.js");
const adapter=new Mt5LiveAdapter({bridgePath:path.resolve("scripts/mt5-bridge.py"),timeoutMs:90000});
const account=await adapter.connect();
if(account.tradeMode!=="demo"){console.log("not a demo account: stopping");process.exit(2);}
const rows:any[]=[];const kept:StrategyBookEntry[]=[];
for(const symbol of symbols){
 const cls=assetClassOf(symbol),profile=PROFILES[cls];
 const timeframes=(arg("timeframes")?.split(",")??profile.timeframes).filter(allowedTf);
 for(const tf of timeframes){
  let candles,spread;
  try{candles=await adapter.getCandles({symbol,timeframe:tf as any,limit:Number(arg("bars")??"99000")});const q=await adapter.getSymbolSnapshot(symbol);spread=q.ask-q.bid;}
  catch(e){rows.push({symbol,tf,error:(e as Error).message});console.log(symbol,tf,"ERROR",(e as Error).message);continue;}
  const context=buildContext(candles,MINUTES[tf]!);
  for(const name of profile.strategies){
    const v=verdict(candles,MINUTES[tf]!,name,spread,context,cls);
    const row={symbol,assetClass:cls,tf,strategy:name,from:candles[0]?.timestamp,to:candles.at(-1)?.timestamp,candles:candles.length,spread,...v};
    rows.push(row);
    if(v.keep)kept.push({symbol,timeframe:tf,strategy:name,assetClass:cls,firstHalf:v.first,secondHalf:v.second,quartersPositive:v.quartersPositive});
    if(v.first.trades+v.second.trades>0)console.log(`${v.keep?"KEEP":"    "} ${symbol.padEnd(10)} ${cls.padEnd(10)} ${tf.padEnd(3)} ${name.padEnd(21)} | 1st ${String(v.first.trades).padStart(3)} tr ${String(v.first.netR).padStart(7)}R PF ${v.first.profitFactor} | 2nd ${String(v.second.trades).padStart(3)} tr ${String(v.second.netR).padStart(7)}R PF ${v.second.profitFactor} | quarters+ ${v.quartersPositive}/4${v.stressed?` | x1.5 spread ${v.stressed.first.netR}R/${v.stressed.second.netR}R`:""}`);
  }
 }
}
adapter.dispose();
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","strategy-backtest-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({account:account.server,keepRule:KEEP_RULE,kept,rows},null,2));
if(process.argv.includes("--write-book")){
  // A strategy the live review suspended stays out until the owner clears it, even if history still likes it.
  const previous=loadStrategyBook() as (ReturnType<typeof loadStrategyBook>&{suspended?:Array<{key:string}>})|null;
  const suspended=previous?.suspended??[];
  const entries=kept.filter(k=>!suspended.some(x=>x.key===`${k.symbol} ${k.timeframe} ${k.strategy}`));
  console.log("strategy book:",saveStrategyBook({measuredAt:new Date().toISOString(),source:out,keepRule:KEEP_RULE,entries,...(suspended.length?{suspended}:{})} as any));
}
console.log(JSON.stringify({report:out,tested:rows.filter(r=>!r.error).length,kept:kept.map(k=>`${k.symbol} ${k.timeframe} ${k.strategy}`)},null,2));
process.exit(0);
