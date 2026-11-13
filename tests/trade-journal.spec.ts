import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {appendJournal,applyReview,readJournal,reviewLive,REVIEW_RULE,type JournalEntry} from "../src/trading/trade-journal.js";
import type {StrategyBook} from "../src/trading/strategy-book.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-journal-"));const file=path.join(dir,"j.jsonl");
const stats=(pf:number)=>({trades:100,winRate:45,netR:20,profitFactor:pf,maxDrawdownR:-10,avgR:0.2});
const book:StrategyBook={measuredAt:"x",source:"t",keepRule:{},entries:[
  {symbol:"BTCUSD",timeframe:"M15",strategy:"macd-momentum",firstHalf:stats(1.26),secondHalf:stats(1.43),quartersPositive:3},
  {symbol:"ETHUSD",timeframe:"M5",strategy:"asian-mean-reversion",firstHalf:stats(1.32),secondHalf:stats(1.19),quartersPositive:4}]};
const trade=(symbol:string,strategy:string,timeframe:string,net:number,i:number):JournalEntry=>({closedAt:`2026-11-${String(10+(i%15)).padStart(2,"0")}T10:00:00Z`,symbol,positionId:String(i),strategy,timeframe,net,quantity:0.001});
// A few trades: too early to judge anything.
for(let i=0;i<5;i++)appendJournal(trade("BTCUSD","macd-momentum","M15",-0.8,i),file);
let r=reviewLive(book,readJournal(file));
assert.equal(r[0]!.verdict,"too early");assert.equal(r[0]!.trades,5);assert.equal(r[1]!.trades,0);
// BTC keeps losing (20 trades, profit factor well under 0.9): suspended; ETH in line with its history.
for(let i=5;i<REVIEW_RULE.minTrades;i++)appendJournal(trade("BTCUSD","macd-momentum","M15",i%4===0?1.2:-0.8,i),file);
for(let i=0;i<22;i++)appendJournal(trade("ETHUSD","asian-mean-reversion","M5",i%2===0?1.4:-0.8,100+i),file);
r=reviewLive(book,readJournal(file));
assert.equal(r[0]!.verdict,"suspend",JSON.stringify(r[0]));assert.equal(r[1]!.verdict,"in line",JSON.stringify(r[1]));
const next=applyReview(book,r);
assert.deepEqual(next.entries.map(e=>e.symbol),["ETHUSD"]);assert.equal(next.suspended![0]!.key,"BTCUSD M15 macd-momentum");
// A broken line in the journal does not lose the rest.
fs.appendFileSync(file,"{not json\n");assert.equal(readJournal(file).length,42);
fs.rmSync(dir,{recursive:true,force:true});
console.log("trade-journal: every close journaled with its strategy; judged only after 20 live trades; a failing strategy is suspended, not re-tuned");
