import type {MarketCandle} from "./scalping-signal.js";
import {STRATEGIES,buildContext,type StrategyName,type StrategyContext} from "./strategies.js";
import {trailingStop,DEFAULT_TRAIL} from "./trailing-stop.js";

/**
 * Replays a strategy on history the way the live robot would trade it: enter at the next candle's open (buy at the ask),
 * one trade at a time, the stop always set, the trailing stop when the strategy uses it, a fixed target when it has one,
 * and a session close hour when it has one. When one candle touches both the stop and the target, the stop counts first
 * (the cautious reading). The spread is paid on every trade. Results are in R (multiples of the first risk).
 */
export interface BacktestTrade{entryAt:string;side:"long"|"short";r:number;bars:number;exit:"stop"|"target"|"session"|"time"|"end"}
export interface BacktestStats{trades:number;winRate:number;netR:number;profitFactor:number|null;maxDrawdownR:number;avgR:number}

export function backtestStrategy(c:MarketCandle[],minutes:number,name:StrategyName,spread:number,from=0,to=c.length,maxBars=600,context?:StrategyContext):BacktestTrade[]{
  const x=context??buildContext(c,minutes),rule=STRATEGIES[name],trades:BacktestTrade[]=[];
  let i=Math.max(from,210);
  while(i<to-1){
    const intent=rule(x,i);
    if(!intent||!(intent.stopDistance>0)){i++;continue;}
    const long=intent.action==="long",o=c[i+1]!.open;
    const entry=long?o+spread:o,risk=intent.stopDistance;
    const first=long?entry-risk:entry+risk;let stop=first;
    const target=intent.target;
    if(target!==undefined&&(long?target<=entry:target>=entry)){i++;continue;}   // already past the target: no trade
    let j=i+1,exit:number|undefined,how:BacktestTrade["exit"]="end";
    for(;j<to&&j<i+1+maxBars;j++){
      const b=c[j]!;
      if(long?b.low<=stop:b.high+spread>=stop){exit=stop;how="stop";break;}
      if(target!==undefined&&(long?b.high>=target:b.low+spread<=target)){exit=target;how="target";break;}
      if(intent.closeHourUtc!==undefined&&new Date(b.timestamp).getUTCHours()>=intent.closeHourUtc&&j>i+1){exit=long?b.close:b.close+spread;how="session";break;}
      if(intent.trail){const a=x.atr[j]!;if(Number.isFinite(a)){const m=trailingStop({side:long?"long":"short",entry,stopLoss:stop,initialStop:first,bid:b.close,ask:b.close+spread,atr:a},DEFAULT_TRAIL);if(m)stop=m.stop;}}
    }
    if(exit===undefined){const b=c[Math.min(j,to-1)]!;exit=long?b.close:b.close+spread;how=j>=i+1+maxBars?"time":"end";}
    trades.push({entryAt:c[i+1]!.timestamp,side:intent.action,r:(long?exit-entry:entry-exit)/risk,bars:j-i,exit:how});
    i=j+1;
  }
  return trades;
}
export function statsOf(t:BacktestTrade[]):BacktestStats{
  let eq=0,peak=0,dd=0,gw=0,gl=0,wins=0;
  for(const x of t){eq+=x.r;peak=Math.max(peak,eq);dd=Math.min(dd,eq-peak);if(x.r>0){gw+=x.r;wins++;}else gl-=x.r;}
  const r2=(v:number)=>Math.round(v*100)/100;
  return{trades:t.length,winRate:t.length?Math.round(wins/t.length*100):0,netR:r2(eq),profitFactor:gl?r2(gw/gl):null,maxDrawdownR:r2(dd),avgR:t.length?r2(eq/t.length):0};
}
/**
 * The bar a strategy must clear on BOTH halves of the history to be switched on. Many combinations are tried, so some pass
 * by luck: the bar is set above break-even, needs enough trades, and the demo account still has the last word.
 */
export const KEEP_RULE={minTradesPerHalf:25,minProfitFactor:1.15,minQuartersPositive:3,
  /** It must also stay profitable on both halves with the spread this many times wider (a result one spread tick can flip
   *  is luck: ETH M5 went from +7R to -4.7R when the spread moved from 1.2 to 2.0, 2026-11-13). */
  stressSpread:1.5};
export function verdict(c:MarketCandle[],minutes:number,name:StrategyName,spread:number,context:StrategyContext=buildContext(c,minutes)){
  const n=c.length,half=Math.floor(n/2),run=(sp:number,a:number,b:number)=>statsOf(backtestStrategy(c,minutes,name,sp,a,b,600,context));
  const first=run(spread,0,half),second=run(spread,half,n);
  const q=[0,1,2,3].map(k=>run(spread,Math.floor(k*n/4),Math.floor((k+1)*n/4)));
  const passHalf=(s:BacktestStats)=>s.trades>=KEEP_RULE.minTradesPerHalf&&(s.profitFactor??0)>=KEEP_RULE.minProfitFactor&&s.netR>0;
  const quartersPositive=q.filter(s=>s.netR>0).length;
  const base=passHalf(first)&&passHalf(second)&&quartersPositive>=KEEP_RULE.minQuartersPositive;
  const stressed=base?{first:run(spread*KEEP_RULE.stressSpread,0,half),second:run(spread*KEEP_RULE.stressSpread,half,n)}:undefined;
  const survivesCosts=!!stressed&&stressed.first.netR>0&&stressed.second.netR>0;
  return{first,second,quartersPositive,stressed,keep:base&&survivesCosts};
}
