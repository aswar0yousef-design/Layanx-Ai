import assert from "node:assert/strict";
import {adxSeries,atrSeries,bollingerSeries,donchianSeries,emaSeries,macdSeries,resample,rsiSeries,smaSeries} from "../src/trading/indicators.js";
import {ema,rsi} from "../src/trading/scalping-signal.js";

const close=Array.from({length:120},(_,i)=>100+Math.sin(i/5)*3+i*0.05);
const candles=close.map((c,i)=>({timestamp:new Date(Date.UTC(2026,10,13,0,i*5)).toISOString(),open:c-0.1,high:c+0.5,low:c-0.5,close:c}));
// Same values as the robot's existing single-value helpers.
assert.ok(Math.abs(emaSeries(close,21)[119]!-ema(close,21)!)<1e-9);
assert.ok(Math.abs(rsiSeries(close,14)[119]!-rsi(close,14)!)<1e-6,`${rsiSeries(close,14)[119]} vs ${rsi(close,14)}`);
assert.equal(smaSeries([1,2,3,4],2)[3],3.5);
assert.ok(Number.isNaN(emaSeries(close,21)[19]!),"no value before enough history");
// ATR of candles with range 1 and no gaps is 1.
assert.ok(Math.abs(atrSeries(candles,14)[60]!-1)<0.2);
const adx=adxSeries(candles,14);assert.ok(adx[100]!>=0&&adx[100]!<=100);
const m=macdSeries(close);assert.ok(Math.abs(m.hist[119]!-(m.macd[119]!-m.signal[119]!))<1e-12);
const bb=bollingerSeries(close);assert.ok(bb.upper[119]!>bb.mid[119]!&&bb.mid[119]!>bb.lower[119]!);
// Donchian excludes the current candle.
const d=donchianSeries(candles,20);assert.equal(d.high[40],Math.max(...candles.slice(20,40).map(c=>c.high)));
// Resample M5 -> M15: a 15-minute candle counts only once its third 5-minute candle has closed.
const r=resample(candles,15,5);
assert.equal(r.candles.length,40);assert.equal(r.completedAt[0],-1);assert.equal(r.completedAt[1],-1);assert.equal(r.completedAt[2],0);assert.equal(r.completedAt[3],0);assert.equal(r.completedAt[5],1);
assert.equal(r.candles[0]!.high,Math.max(candles[0]!.high,candles[1]!.high,candles[2]!.high));
console.log("indicators: EMA/RSI match the robot's helpers, ATR, ADX, MACD, Bollinger, Donchian, resampling without peeking");
