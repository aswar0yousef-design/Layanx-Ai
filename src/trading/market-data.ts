import type {Candle} from "./strategy.js";

export interface MarketBar extends Candle{bidOpen?:number;bidHigh?:number;bidLow?:number;bidClose?:number;askOpen?:number;askHigh?:number;askLow?:number;askClose?:number;spread?:number;}

function number(value:string|undefined,name:string):number{const n=Number(value);if(!Number.isFinite(n))throw new Error("Invalid "+name+" in market data.");return n;}
function splitCsvLine(line:string):string[]{return line.split(",").map(value=>value.trim());}

export function parseMarketCsv(csv:string):MarketBar[]{
 const lines=csv.replace(/^\uFEFF/,"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);if(lines.length<2)throw new Error("Market CSV requires a header and at least one row.");
 const header=splitCsvLine(lines[0]!).map(x=>x.toLowerCase());const col=(...names:string[])=>{const i=names.map(n=>header.indexOf(n)).find(i=>i>=0);return i??-1;};
 const time=col("timestamp","time","datetime","date"),open=col("open","o"),high=col("high","h"),low=col("low","l"),close=col("close","c"),bid=col("bid"),ask=col("ask");
 if(time<0)throw new Error("Market CSV requires timestamp/time/datetime/date.");
 if(open<0||high<0||low<0||close<0)throw new Error("Market CSV requires OHLC columns.");
 return lines.slice(1).map((line,index)=>{const v=splitCsvLine(line);const rawTime=v[time];if(rawTime===undefined)throw new Error("Missing timestamp at row "+(index+2));const timestamp=Number.isFinite(Number(rawTime))?Number(rawTime):Date.parse(rawTime);if(!Number.isFinite(timestamp))throw new Error("Invalid timestamp at row "+(index+2));const o=number(v[open],"open"),h=number(v[high],"high"),l=number(v[low],"low"),c=number(v[close],"close");if(h<Math.max(o,c)||l>Math.min(o,c)||l>h)throw new Error("Invalid OHLC relationship at row "+(index+2));const b:MarketBar={timestamp,open:o,high:h,low:l,close:c};if(bid>=0)b.bidClose=number(v[bid],"bid");if(ask>=0)b.askClose=number(v[ask],"ask");if(b.bidClose!==undefined&&b.askClose!==undefined)b.spread=b.askClose-b.bidClose;return b;});
}

export function sortMarketBars(bars:MarketBar[]):MarketBar[]{return [...bars].sort((a,b)=>a.timestamp-b.timestamp);}
