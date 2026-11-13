/**
 * Does the trailing stop help? The robot's own entries (generateScalpingSignal) replayed on real history from the MT5 demo
 * account, with four ways to exit, judged separately on the first and second half of the data (a rule that only wins on the
 * half it was looked at is not kept). Costs: the symbol's current spread on every trade. When a candle touches both the
 * stop and the target, the stop is assumed first (the cautious reading).
 *
 *   npx tsx scripts/trailing-backtest.ts [--timeframes M5,M15] [--symbols XAUUSD,EURUSD,WTI]
 */
import fs from "node:fs";
import path from "node:path";
import {resolveDataPaths} from "../src/platform/paths.js";
import {generateScalpingSignal,atr as atrOf} from "../src/trading/scalping-signal.js";
import {trailingStop,DEFAULT_TRAIL} from "../src/trading/trailing-stop.js";

const arg=(n:string)=>{const i=process.argv.indexOf("--"+n);return i>=0?process.argv[i+1]:undefined;};
const symbols=(arg("symbols")??"XAUUSD,EURUSD,GBPUSD,WTI,BTCUSD").split(",");
const timeframes=(arg("timeframes")??"M5,M15").split(",");
const {Mt5LiveAdapter}=await import("../src/trading/mt5-live-adapter.js");
const adapter=new Mt5LiveAdapter({bridgePath:path.resolve("scripts/mt5-bridge.py"),timeoutMs:60000});
const account=await adapter.connect();
if(account.tradeMode!=="demo"){console.log("not a demo account: stopping");process.exit(2);}

type Variant={name:string;tpR:number|null;trail:"none"|"breakeven"|"full"};
const VARIANTS:Variant[]=[
  {name:"fixed 1.5R (today)",tpR:1.5,trail:"none"},
  {name:"breakeven at 1R, target 1.5R",tpR:1.5,trail:"breakeven"},
  {name:"trailing, target 3R",tpR:3,trail:"full"},
  {name:"trailing, no target",tpR:null,trail:"full"},
];
interface Trade{r:number;bars:number}
function simulate(c:any[],spread:number,v:Variant,from:number,to:number):Trade[]{
  const trades:Trade[]=[];let i=Math.max(from,60);
  while(i<to-1){
    const window=c.slice(i-59,i+1);
    const sig=generateScalpingSignal(window);
    if(sig.action==="neutral"||!sig.indicators.atr){i++;continue;}
    const atr=sig.indicators.atr,long=sig.action==="long";
    const entry=long?c[i+1].open+spread:c[i+1].open;          // buy at the ask, sell at the bid
    const risk=1.2*atr;let stop=long?entry-risk:entry+risk;const first=stop;
    const target=v.tpR===null?null:long?entry+v.tpR*risk:entry-v.tpR*risk;
    let j=i+1,exit:number|undefined;
    for(;j<to&&j<i+1+600;j++){
      const b=c[j];const lowBid=b.low,highBid=b.high,lowAsk=b.low+spread,highAsk=b.high+spread;
      if(long?lowBid<=stop:highAsk>=stop){exit=stop;break;}
      if(target!==null&&(long?highBid>=target:lowAsk<=target)){exit=target;break;}
      if(v.trail!=="none"){
        const a=atrOf(c.slice(Math.max(0,j-30),j+1),14)??atr;
        const rules=v.trail==="breakeven"?{...DEFAULT_TRAIL,trailFromR:1e9}:DEFAULT_TRAIL;
        const m=trailingStop({side:long?"long":"short",entry,stopLoss:stop,initialStop:first,bid:b.close,ask:b.close+spread,atr:a},rules);
        if(m)stop=m.stop;
      }
    }
    if(exit===undefined){const b=c[Math.min(j,to-1)];exit=long?b.close:b.close+spread;}
    trades.push({r:(long?exit-entry:entry-exit)/risk,bars:j-i});
    i=j+1;
  }
  return trades;
}
const stats=(t:Trade[])=>{let eq=0,peak=0,dd=0;for(const x of t){eq+=x.r;peak=Math.max(peak,eq);dd=Math.min(dd,eq-peak);}
  const wins=t.filter(x=>x.r>0),loss=t.filter(x=>x.r<=0);const gw=wins.reduce((a,x)=>a+x.r,0),gl=-loss.reduce((a,x)=>a+x.r,0);
  return{trades:t.length,winRate:t.length?Math.round(wins.length/t.length*100):0,netR:Math.round(eq*100)/100,profitFactor:gl?Math.round(gw/gl*100)/100:null,maxDrawdownR:Math.round(dd*100)/100};};

const rows:any[]=[];
for(const symbol of symbols)for(const tf of timeframes){
  let candles:any[];let spread:number;
  try{candles=await adapter.getCandles({symbol,timeframe:tf as any,limit:5000});const q=await adapter.getSymbolSnapshot(symbol);spread=q.ask-q.bid;}
  catch(e){rows.push({symbol,tf,error:(e as Error).message});continue;}
  const half=Math.floor(candles.length/2);
  for(const v of VARIANTS){
    rows.push({symbol,tf,variant:v.name,candles:candles.length,from:candles[0]?.timestamp,first:stats(simulate(candles,spread,v,0,half)),second:stats(simulate(candles,spread,v,half,candles.length))});
  }
}
adapter.dispose();
const total=(name:string,part:"first"|"second")=>Math.round(rows.filter(r=>r.variant===name).reduce((a,r)=>a+r[part].netR,0)*100)/100;
const summary=VARIANTS.map(v=>({variant:v.name,firstHalfNetR:total(v.name,"first"),secondHalfNetR:total(v.name,"second")}));
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","trailing-backtest-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify({account:account.server,summary,rows},null,2));
for(const r of rows)if(!r.error)console.log(`${r.symbol} ${r.tf} | ${r.variant.padEnd(30)} | 1st: ${r.first.trades} trades ${r.first.netR}R PF ${r.first.profitFactor} | 2nd: ${r.second.trades} trades ${r.second.netR}R PF ${r.second.profitFactor} DD ${r.second.maxDrawdownR}R`);else console.log(r.symbol,r.tf,"ERROR",r.error);
console.log(JSON.stringify({report:out,summary},null,2));
process.exit(0);
