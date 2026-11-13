import type {MarketCandle} from "./scalping-signal.js";
import {adxSeries,atrSeries,bollingerSeries,donchianSeries,emaSeries,macdSeries,resample,rsiSeries,type Series} from "./indicators.js";

/**
 * Entry rules for well-known strategies. Each looks only at candles that have closed (index i and before) and returns what
 * to do at the next candle's open: the side, the stop distance, an optional fixed target, and whether the trailing stop
 * manages the trade. None of them is assumed to work: scripts/strategy-backtest.ts measures each on real history, and only
 * those that win in both halves of the data are switched on (src/trading/strategy-book.ts).
 */
export type StrategyName="trend-pullback"|"macd-momentum"|"london-breakout"|"asian-mean-reversion"|"donchian-breakout";
export const STRATEGY_NAMES:StrategyName[]=["trend-pullback","macd-momentum","london-breakout","asian-mean-reversion","donchian-breakout"];
export interface Intent{action:"long"|"short";stopDistance:number;target?:number;trail:boolean;closeHourUtc?:number;reason:string}
export interface StrategyContext{
  c:MarketCandle[];minutes:number;
  atr:Series;rsi:Series;ema21:Series;adx:Series;macd:Series;macdSignal:Series;bbMid:Series;bbUpper:Series;bbLower:Series;donHigh:Series;donLow:Series;
  /** Trend of the higher timeframe at each candle, from its last COMPLETE candle: 1 up, -1 down, 0 none. */
  htfTrend:Int8Array;
}
/** The higher timeframe each entry timeframe takes its trend from (as in the owner's GoldMaster table). */
export const HIGHER:Record<number,number>={1:15,5:15,15:60,30:240,60:240,240:1440};

export function buildContext(c:MarketCandle[],minutes:number):StrategyContext{
  const closes=c.map(x=>x.close);
  const m=macdSeries(closes),bb=bollingerSeries(closes,20,2),don=donchianSeries(c,20);
  const htfMinutes=HIGHER[minutes]??minutes*4;
  const h=resample(c,htfMinutes,minutes),hc=h.candles.map(x=>x.close);
  const e50=emaSeries(hc,50),e200=emaSeries(hc,200),hadx=adxSeries(h.candles,14);
  const htfTrend=new Int8Array(c.length);
  for(let i=0;i<c.length;i++){
    const k=h.completedAt[i]!;if(k<0)continue;
    const up=e50[k]!>e200[k]!&&hc[k]!>e50[k]!&&hadx[k]!>=20,down=e50[k]!<e200[k]!&&hc[k]!<e50[k]!&&hadx[k]!>=20;
    htfTrend[i]=up?1:down?-1:0;
  }
  return{c,minutes,atr:atrSeries(c,14),rsi:rsiSeries(closes,14),ema21:emaSeries(closes,21),adx:adxSeries(c,14),macd:m.macd,macdSignal:m.signal,
    bbMid:bb.mid,bbUpper:bb.upper,bbLower:bb.lower,donHigh:don.high,donLow:don.low,htfTrend};
}
const hourUtc=(c:MarketCandle)=>new Date(c.timestamp).getUTCHours();
const dayUtc=(c:MarketCandle)=>c.timestamp.slice(0,10);
const ok=(...v:number[])=>v.every(x=>Number.isFinite(x));

/** Pullback to EMA21 in the higher timeframe's trend, closing back with the trend, RSI on the trend's side and rising. */
function trendPullback(x:StrategyContext,i:number):Intent|null{
  const c=x.c[i]!,p=x.c[i-1]!,t=x.htfTrend[i]!,a=x.atr[i]!,e=x.ema21[i]!,r=x.rsi[i]!,rp=x.rsi[i-1]!;
  if(!t||!ok(a,e,r,rp))return null;
  if(t>0&&c.low<=e&&c.close>e&&c.close>c.open&&r>50&&r<70&&r>rp)return{action:"long",stopDistance:Math.max(1.5*a,c.close-c.low+0.2*a),trail:true,reason:"pullback to EMA21 in an uptrend"};
  if(t<0&&c.high>=e&&c.close<e&&c.close<c.open&&r<50&&r>30&&r<rp)return{action:"short",stopDistance:Math.max(1.5*a,c.high-c.close+0.2*a),trail:true,reason:"pullback to EMA21 in a downtrend"};
  void p;return null;
}
/** MACD crossing its signal line in the higher timeframe's trend, with a trending entry timeframe (ADX >= 20). */
function macdMomentum(x:StrategyContext,i:number):Intent|null{
  const t=x.htfTrend[i]!,a=x.atr[i]!,m=x.macd[i]!,s=x.macdSignal[i]!,mp=x.macd[i-1]!,sp=x.macdSignal[i-1]!,adx=x.adx[i]!;
  if(!t||!ok(a,m,s,mp,sp,adx)||adx<20)return null;
  if(t>0&&mp<=sp&&m>s)return{action:"long",stopDistance:1.5*a,trail:true,reason:"MACD crossed up in an uptrend"};
  if(t<0&&mp>=sp&&m<s)return{action:"short",stopDistance:1.5*a,trail:true,reason:"MACD crossed down in a downtrend"};
  return null;
}
/** London breakout (M15/M30): the first close outside the Asian range (00-07 UTC) between 07 and 12 UTC; stop at mid-range. */
function londonBreakout(x:StrategyContext,i:number):Intent|null{
  if(x.minutes<15||x.minutes>30)return null;
  const c=x.c[i]!,h=hourUtc(c),a=x.atr[i]!;
  if(h<7||h>=12||!ok(a))return null;
  const day=dayUtc(c);let hi=-Infinity,lo=Infinity,j=i;
  // Walk back over today: the Asian candles make the range; a close already outside it after 07:00 means not the first.
  let brokeUp=false,brokeDown=false;const today:MarketCandle[]=[];
  for(j=i-1;j>=0&&dayUtc(x.c[j]!)===day;j--)today.push(x.c[j]!);
  for(const k of today)if(hourUtc(k)<7){hi=Math.max(hi,k.high);lo=Math.min(lo,k.low);}
  if(!Number.isFinite(hi))return null;
  for(const k of today)if(hourUtc(k)>=7){if(k.close>hi)brokeUp=true;if(k.close<lo)brokeDown=true;}
  const width=hi-lo;
  if(width<2*a||width>12*a)return null;
  const mid=(hi+lo)/2;
  if(c.close>hi&&!brokeUp)return{action:"long",stopDistance:Math.max(c.close-mid,a),trail:true,closeHourUtc:21,reason:"London broke above the Asian range"};
  if(c.close<lo&&!brokeDown)return{action:"short",stopDistance:Math.max(mid-c.close,a),trail:true,closeHourUtc:21,reason:"London broke below the Asian range"};
  return null;
}
/** Quiet Asian hours (00-06 UTC), no trend (ADX < 20): a close outside the Bollinger band with RSI stretched, back to the middle. */
function asianMeanReversion(x:StrategyContext,i:number):Intent|null{
  const c=x.c[i]!,h=hourUtc(c),a=x.atr[i]!,adx=x.adx[i]!,r=x.rsi[i]!,mid=x.bbMid[i]!,up=x.bbUpper[i]!,lo=x.bbLower[i]!;
  if(h>=6||x.minutes>15||!ok(a,adx,r,mid,up,lo)||adx>=20)return null;
  if(c.close<lo&&r<30)return{action:"long",stopDistance:1.5*a,target:mid,trail:false,closeHourUtc:8,reason:"stretched below the band in a quiet range"};
  if(c.close>up&&r>70)return{action:"short",stopDistance:1.5*a,target:mid,trail:false,closeHourUtc:8,reason:"stretched above the band in a quiet range"};
  return null;
}
/** Donchian (turtle) breakout: a close beyond the last 20 candles' high/low, in the higher timeframe's trend. */
function donchianBreakout(x:StrategyContext,i:number):Intent|null{
  const c=x.c[i]!,t=x.htfTrend[i]!,a=x.atr[i]!,hi=x.donHigh[i]!,lo=x.donLow[i]!;
  if(!t||!ok(a,hi,lo))return null;
  if(t>0&&c.close>hi)return{action:"long",stopDistance:2*a,trail:true,reason:"20-candle breakout up in an uptrend"};
  if(t<0&&c.close<lo)return{action:"short",stopDistance:2*a,trail:true,reason:"20-candle breakout down in a downtrend"};
  return null;
}
export const STRATEGIES:Record<StrategyName,(x:StrategyContext,i:number)=>Intent|null>={
  "trend-pullback":trendPullback,"macd-momentum":macdMomentum,"london-breakout":londonBreakout,
  "asian-mean-reversion":asianMeanReversion,"donchian-breakout":donchianBreakout
};
