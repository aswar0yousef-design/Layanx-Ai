import type {MarketCandle} from "./scalping-signal.js";

/**
 * Indicator series over a whole candle history: value[i] uses candles 0..i only (never a later candle), NaN until there is
 * enough history. Wilder's smoothing for RSI, ATR and ADX, as trading platforms compute them.
 */
export type Series=Float64Array;
const nan=(n:number)=>new Float64Array(n).fill(Number.NaN);

export function emaSeries(values:ArrayLike<number>,period:number):Series{
  const out=nan(values.length),k=2/(period+1);
  let sum=0,prev=Number.NaN;
  for(let i=0;i<values.length;i++){
    const v=values[i]!;
    if(i<period){sum+=v;if(i===period-1){prev=sum/period;out[i]=prev;}continue;}
    prev=v*k+prev*(1-k);out[i]=prev;
  }
  return out;
}
export function smaSeries(values:ArrayLike<number>,period:number):Series{
  const out=nan(values.length);let sum=0;
  for(let i=0;i<values.length;i++){sum+=values[i]!;if(i>=period)sum-=values[i-period]!;if(i>=period-1)out[i]=sum/period;}
  return out;
}
function wilder(values:ArrayLike<number>,period:number,start:number):Series{
  const out=nan(values.length);let acc=0,prev=Number.NaN;
  for(let i=start;i<values.length;i++){
    if(i<start+period){acc+=values[i]!;if(i===start+period-1){prev=acc/period;out[i]=prev;}continue;}
    prev=(prev*(period-1)+values[i]!)/period;out[i]=prev;
  }
  return out;
}
export function rsiSeries(closes:ArrayLike<number>,period=14):Series{
  const n=closes.length,gain=new Float64Array(n),loss=new Float64Array(n);
  for(let i=1;i<n;i++){const d=closes[i]!-closes[i-1]!;gain[i]=Math.max(d,0);loss[i]=Math.max(-d,0);}
  const g=wilder(gain,period,1),l=wilder(loss,period,1),out=nan(n);
  for(let i=0;i<n;i++)if(!Number.isNaN(g[i]!))out[i]=l[i]===0?100:100-100/(1+g[i]!/l[i]!);
  return out;
}
export function trueRange(c:MarketCandle[]):Series{
  const tr=new Float64Array(c.length);
  for(let i=0;i<c.length;i++){const h=c[i]!.high,l=c[i]!.low;tr[i]=i===0?h-l:Math.max(h-l,Math.abs(h-c[i-1]!.close),Math.abs(l-c[i-1]!.close));}
  return tr;
}
export function atrSeries(c:MarketCandle[],period=14):Series{return wilder(trueRange(c),period,0);}
/** Average Directional Index: trend strength (above ~20-25 a trend, below ~20 a range). */
export function adxSeries(c:MarketCandle[],period=14):Series{
  const n=c.length,plus=new Float64Array(n),minus=new Float64Array(n),tr=trueRange(c);
  for(let i=1;i<n;i++){
    const up=c[i]!.high-c[i-1]!.high,down=c[i-1]!.low-c[i]!.low;
    plus[i]=up>down&&up>0?up:0;minus[i]=down>up&&down>0?down:0;
  }
  const trS=wilder(tr,period,1),pS=wilder(plus,period,1),mS=wilder(minus,period,1),dx=new Float64Array(n);
  const start=period;
  for(let i=start;i<n;i++){const p=100*pS[i]!/trS[i]!,m=100*mS[i]!/trS[i]!;dx[i]=p+m===0?0:100*Math.abs(p-m)/(p+m);}
  return wilder(dx,period,start);
}
export function macdSeries(closes:ArrayLike<number>,fast=12,slow=26,signal=9):{macd:Series;signal:Series;hist:Series}{
  const f=emaSeries(closes,fast),s=emaSeries(closes,slow),n=closes.length,macd=nan(n);
  for(let i=0;i<n;i++)macd[i]=f[i]!-s[i]!;
  const first=macd.findIndex(v=>!Number.isNaN(v));
  const sig=nan(n);
  if(first>=0){const tail=emaSeries(macd.subarray(first),signal);sig.set(tail,first);}
  const hist=nan(n);for(let i=0;i<n;i++)hist[i]=macd[i]!-sig[i]!;
  return{macd,signal:sig,hist};
}
export function bollingerSeries(closes:ArrayLike<number>,period=20,width=2):{mid:Series;upper:Series;lower:Series}{
  const n=closes.length,mid=smaSeries(closes,period),upper=nan(n),lower=nan(n);
  for(let i=period-1;i<n;i++){
    let v=0;for(let j=i-period+1;j<=i;j++)v+=(closes[j]!-mid[i]!)**2;
    const sd=Math.sqrt(v/period);upper[i]=mid[i]!+width*sd;lower[i]=mid[i]!-width*sd;
  }
  return{mid,upper,lower};
}
/** Highest high and lowest low of the `period` candles BEFORE i (the breakout candle itself is not in its own channel). */
export function donchianSeries(c:MarketCandle[],period=20):{high:Series;low:Series}{
  const n=c.length,high=nan(n),low=nan(n);
  for(let i=period;i<n;i++){let h=-Infinity,l=Infinity;for(let j=i-period;j<i;j++){h=Math.max(h,c[j]!.high);l=Math.min(l,c[j]!.low);}high[i]=h;low[i]=l;}
  return{high,low};
}
/**
 * Candles of a higher timeframe built from lower ones, and for each lower candle the index of the last higher candle that
 * was already COMPLETE when that lower candle closed (no peeking at an unfinished hour). -1 when none yet.
 */
export function resample(c:MarketCandle[],minutes:number,baseMinutes:number):{candles:MarketCandle[];completedAt:Int32Array}{
  const ms=minutes*60_000,out:MarketCandle[]=[],completedAt=new Int32Array(c.length).fill(-1);
  let bucket=-1;
  for(let i=0;i<c.length;i++){
    const t=Date.parse(c[i]!.timestamp),b=Math.floor(t/ms);
    if(b!==bucket){out.push({timestamp:new Date(b*ms).toISOString(),open:c[i]!.open,high:c[i]!.high,low:c[i]!.low,close:c[i]!.close});bucket=b;}
    else{const last=out.at(-1)!;last.high=Math.max(last.high,c[i]!.high);last.low=Math.min(last.low,c[i]!.low);last.close=c[i]!.close;}
    // This lower candle closes at t + base; the higher candle is complete when that reaches the end of its bucket.
    const closes=t+baseMinutes*60_000;
    completedAt[i]=closes>=(b+1)*ms?out.length-1:out.length-2;
  }
  return{candles:out,completedAt};
}
