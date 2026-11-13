import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-weekly-"));
process.env.LAYANX_STRATEGY_BOOK=path.join(dir,"book.json");process.env.LAYANX_TRADE_JOURNAL=path.join(dir,"journal.jsonl");
const {weeklyTradingDue,runWeeklyTradingLearning}=await import("../src/trading/weekly-learning.js");
const {saveStrategyBook,loadStrategyBook}=await import("../src/trading/strategy-book.js");
const {appendJournal}=await import("../src/trading/trade-journal.js");
const store=path.join(dir,"store");
assert.equal(weeklyTradingDue(store),false,"no book: nothing to learn");
const stats={trades:100,winRate:45,netR:20,profitFactor:1.3,maxDrawdownR:-10,avgR:0.2};
saveStrategyBook({measuredAt:"x",source:"t",keepRule:{},entries:[
  {symbol:"BTCUSD",timeframe:"M15",strategy:"macd-momentum",firstHalf:stats,secondHalf:stats,quartersPositive:3},
  {symbol:"ETHUSD",timeframe:"M5",strategy:"asian-mean-reversion",firstHalf:stats,secondHalf:stats,quartersPositive:4}]});
assert.equal(weeklyTradingDue(store),true);
for(let i=0;i<25;i++)appendJournal({closedAt:"2026-11-14T10:00:00Z",symbol:"BTCUSD",positionId:String(i),strategy:"macd-momentum",timeframe:"M15",net:i%5===0?1:-0.8,quantity:0.001});
let remeasured=0;
const r=await runWeeklyTradingLearning(store,{remeasure:async()=>{remeasured++;return 0;}});
assert.deepEqual(r,{suspended:["BTCUSD M15 macd-momentum"],remeasured:true});assert.equal(remeasured,1);
const book=loadStrategyBook() as any;
assert.deepEqual(book.entries.map((e:any)=>e.symbol),["ETHUSD"]);assert.equal(book.suspended[0].key,"BTCUSD M15 macd-momentum");
assert.equal(weeklyTradingDue(store),false,"done this week");
assert.equal(weeklyTradingDue(store,Date.now()+8*24*3600_000),true,"due again next week");
process.env.LAYANX_TRADING_LEARNING="off";assert.equal(weeklyTradingDue(store,Date.now()+8*24*3600_000),false);
fs.rmSync(dir,{recursive:true,force:true});
console.log("weekly-trading-learning: weekly, suspends a failing strategy, re-measures, can be turned off");
