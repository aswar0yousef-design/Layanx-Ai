/**
 * Every strategy on every market and timeframe, on real history from the MT5 demo account; writes the strategy book that
 * switches on only those that clear KEEP_RULE on both halves (and 3 of 4 quarters).
 *
 *   npx tsx scripts/strategy-backtest.ts [--symbols XAUUSD,EURUSD,...] [--timeframes M5,M15,H1] [--write-book]
 */
import fs from "node:fs";
import path from "node:path";
import {resolveDataPaths} from "../src/platform/paths.js";
import {STRATEGY_NAMES} from "../src/trading/strategies.js";
import {verdict,KEEP_RULE} from "../src/trading/strategy-backtest.js";
import {saveStrategyBook,type StrategyBookEntry} from "../src/trading/strategy-book.js";

const arg=(n:string)=>{const i=process.argv.indexOf("--"+n);return i>=0?process.argv[i+1]:undefined;};
const symbols=(arg("symbols")??"XAUUSD,EURUSD,GBPUSD,USDJPY,WTI,BRENT,BTCUSD,ETHUSD").split(",");
const timeframes=(arg("timeframes")??"M5,M15,H1").split(",");
const MINUTES:Record<string,number>={M1:1,M5:5,M15:15,M30:30,H1:60,H4:240};
const {Mt5LiveAdapter}=await import("../src/trading/mt5-live-adapter.js");
const adapter=new Mt5LiveAdapter({bridgePath:path.resolve("scripts/mt5-bridge.py"),timeoutMs:90000});
const account=await adapter.connect();
if(account.tradeMode!=="demo"){console.log("not a demo account: stopping");process.exit(2);}
const rows:any[]=[];const kept:StrategyBookEntry[]=[];
for(const symbol of symbols)for(const tf of timeframes){
  let candles,spread;
  try{candles=await adapter.getCandles({symbol,timeframe:tf as any,limit:Number(arg("bars")??"99000")});const q=await adapter.getSymbolSnapshot(symbol);spread=q.ask-q.bid;}
  catch(e){rows.push({symbol,tf,error:(e as Error).message});console.log(symbol,tf,"ERROR",(e as Error).message);continue;}
  for(const name of STRATEGY_NAMES){
    const v=verdict(candles,MINUTES[tf]!,name,spread);
    const row={symbol,tf,strategy:name,from:candles[0]?.timestamp,to:candles.at(-1)?.timestamp,candles:candles.length,spread,...v};
    rows.push(row);
    if(v.keep)kept.push({symbol,timeframe:tf,strategy:name,firstHalf:v.first,secondHalf:v.second,quartersPositive:v.quartersPositive});
    if(v.first.trades+v.second.trades>0)console.log(`${v.keep?"KEEP":"    "} ${symbol.padEnd(7)} ${tf.padEnd(3)} ${name.padEnd(21)} | 1st ${String(v.first.trades).padStart(3)} tr ${String(v.first.netR).padStart(7)}R PF ${v.first.profitFactor} | 2nd ${String(v.second.trades).padStart(3)} tr ${String(v.second.netR).padStart(7)}R PF ${v.second.profitFactor} | quarters+ ${v.quartersPositive}/4`);
  }
}
adapter.dispose();
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","strategy-backtest-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({account:account.server,keepRule:KEEP_RULE,kept,rows},null,2));
if(process.argv.includes("--write-book"))console.log("strategy book:",saveStrategyBook({measuredAt:new Date().toISOString(),source:out,keepRule:KEEP_RULE,entries:kept}));
console.log(JSON.stringify({report:out,tested:rows.filter(r=>!r.error).length,kept:kept.map(k=>`${k.symbol} ${k.timeframe} ${k.strategy}`)},null,2));
process.exit(0);
