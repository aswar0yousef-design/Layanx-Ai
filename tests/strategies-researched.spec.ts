import assert from "node:assert/strict";
import {STRATEGIES,buildContext} from "../src/trading/strategies.js";

// New York opening range on M5, on a winter day (EST: 09:30 New York = 14:30 UTC) and a summer day (EDT: 13:30 UTC).
function day(dateUtcOpen:string,breakUp:boolean){
  const start=Date.parse(dateUtcOpen)-6*3600_000;   // from six hours before the open
  return Array.from({length:12*9},(_,k)=>{
    const t=start+k*300_000,minsAfterOpen=(t-Date.parse(dateUtcOpen))/60_000;
    let o=2400,h=2401,l=2399,c=2400;
    if(minsAfterOpen>=0&&minsAfterOpen<30){h=2403;l=2397;}             // the opening range: 2397-2403
    if(minsAfterOpen===40){c=breakUp?2404.5:2400;h=c+0.5;l=2399;}      // 10:10 New York: first close above it
    return{timestamp:new Date(t).toISOString(),open:o,high:h,low:l,close:c};
  });
}
for(const [open,label] of [["2026-11-13T14:30:00Z","winter"],["2026-07-15T13:30:00Z","summer"]] as const){
  const c=day(open,true),x=buildContext(c,5);
  const i=c.findIndex(k=>k.timestamp===new Date(Date.parse(open)+40*60_000).toISOString());
  const intent=STRATEGIES["ny-opening-range"](x,i);
  assert.equal(intent?.action,"long",label);
  assert.equal(intent?.closeHourUtc,label==="winter"?20:19,"closed at 15:00 New York");
  assert.equal(STRATEGIES["ny-opening-range"](x,i+1),null,"only the first break of the day");
  // Inside the opening range itself: never a trade.
  assert.equal(STRATEGIES["ny-opening-range"](x,i-5),null);
}
// RSI(2): a sharp drop in an uptrend gives a long with the 5 average as the target.
const up=Array.from({length:260},(_,k)=>{const c=2000+k*2-(k>=257?(k-256)*12:0);return{timestamp:new Date(Date.UTC(2026,0,1)+k*3600_000).toISOString(),open:c,high:c+3,low:c-3,close:c};});
const rx=buildContext(up,60),ri=up.length-1;
const r2=STRATEGIES["rsi2-reversion"](rx,ri);
assert.equal(r2?.action,"long");assert.ok(r2!.target!>up[ri]!.close&&!r2!.trail);
// Squeeze: needs six squeezed candles before the release.
const flat=Array.from({length:300},(_,k)=>{const big=k>=290;const c=2000+(big?(k-289)*6:Math.sin(k)*0.2);return{timestamp:new Date(Date.UTC(2026,0,1)+k*900_000).toISOString(),open:c,high:c+(big?3:1),low:c-(big?3:1),close:c};});
const sx=buildContext(flat,15);
const fired=flat.map((_,k)=>STRATEGIES["squeeze-breakout"](sx,k)).filter(Boolean);
assert.ok(fired.length>=1&&fired.every(f=>f!.action==="long"),"the release upward gives a long: "+JSON.stringify(fired));
console.log("strategies-researched: NY opening range with daylight saving, RSI(2) reversion, squeeze breakout");
