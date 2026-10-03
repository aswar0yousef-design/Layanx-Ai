import {parseMarketCsv,sortMarketBars} from "../src/trading/market-data.js";
const bars=sortMarketBars(parseMarketCsv("timestamp,open,high,low,close,bid,ask\n2026-01-02T00:01:00Z,2650,2652,2649,2651,2650.9,2651.1\n2026-01-02T00:00:00Z,2648,2651,2647,2650,2649.9,2650.1"));
if(bars.length!==2||bars[0]?.close!==2650||bars[1]?.spread!==.2)throw new Error("Market data normalization failed.");
console.log(JSON.stringify({ok:true,bars:bars.length,spread:bars[1]?.spread}));
