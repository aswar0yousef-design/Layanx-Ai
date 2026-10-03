import type {Candle} from "./strategy.js";

export interface MarketBar extends Candle{bidOpen?:number;bidHigh?:number;bidLow?:number;bidClose?:number;askOpen?:number;askHigh?:number;askLow?:number;askClose?:number;spread?:number;}
export interface MarketDataQuality{bars:number;duplicateTimestamps:number;outOfOrderPairs:number;negativeSpreads:number;estimatedIntervalMs:number;gaps:number;valid:boolean;}

function number(value:string|undefined,name:string):number{const n=Number(value);if(!Number.isFinite(n))throw new Error("Invalid "+name+" in market data.");return n;}
function splitCsvLine(line:string):string[]{return line.split(",").map(value=>value.trim());}

export function parseMarketCsv(csv:string):MarketBar[]{
 const lines=csv.replace(/^\uFEFF/,"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(lines.length<2)throw new Error("Market CSV requires a header and at least one row.");
 const header=splitCsvLine(lines[0]!).map(x=>x.toLowerCase());const col=(...names:string[])=>{const i=names.map(n=>header.indexOf(n)).find(i=>i>=0);return i??-1;};
 const time=col("timestamp","time","datetime","date"),open=col("open","o"),high=col("high","h"),low=col("low","l"),close=col("close","c"),bid=col("bid","bidclose","bid_close"),ask=col("ask","askclose","ask_close");
 if(time<0)throw new Error("Market CSV requires timestamp/time/datetime/date.");
 if(open<0||high<0||low<0||close<0)throw new Error("Market CSV requires OHLC columns.");
 return lines.slice(1).map((line,index)=>{const v=splitCsvLine(line);const rawTime=v[time];if(rawTime===undefined)throw new Error("Missing timestamp at row "+(index+2));const timestamp=Number.isFinite(Number(rawTime))?Number(rawTime):Date.parse(rawTime);if(!Number.isFinite(timestamp))throw new Error("Invalid timestamp at row "+(index+2));const o=number(v[open],"open"),h=number(v[high],"high"),l=number(v[low],"low"),c=number(v[close],"close");if(h<Math.max(o,c)||l>Math.min(o,c)||l>h)throw new Error("Invalid OHLC relationship at row "+(index+2));const b:MarketBar={timestamp,open:o,high:h,low:l,close:c};if(bid>=0)b.bidClose=number(v[bid],"bid");if(ask>=0)b.askClose=number(v[ask],"ask");if(b.bidClose!==undefined&&b.askClose!==undefined)b.spread=b.askClose-b.bidClose;return b;});
}

export function sortMarketBars(bars:MarketBar[]):MarketBar[]{return [...bars].sort((a,b)=>a.timestamp-b.timestamp);}

export function validateMarketData(bars:MarketBar[]):MarketDataQuality{
 const timestamps=bars.map(b=>b.timestamp),unique=new Set(timestamps);let outOfOrderPairs=0,negativeSpreads=0;
 const deltas:number[]=[];for(let i=1;i<bars.length;i++){const prev=bars[i-1],current=bars[i];if(!prev||!current)continue;if(current.timestamp<prev.timestamp)outOfOrderPairs++;const delta=current.timestamp-prev.timestamp;if(delta>0)deltas.push(delta);if(current.spread!==undefined&&current.spread<0)negativeSpreads++;}
 const sorted=[...deltas].sort((a,b)=>a-b);const estimatedIntervalMs=sorted.length?sorted[Math.floor(sorted.length/2)]??0:0;const gaps=estimatedIntervalMs>0?deltas.filter(delta=>delta>estimatedIntervalMs*2).length:0;
 return{bars:bars.length,duplicateTimestamps:timestamps.length-unique.size,outOfOrderPairs,negativeSpreads,estimatedIntervalMs,gaps,valid:timestamps.length>0&&unique.size===timestamps.length&&negativeSpreads===0};
}
