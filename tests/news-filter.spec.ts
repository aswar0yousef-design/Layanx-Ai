import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {NewsCalendar,currenciesFor,newsBlock,type NewsEvent} from "../src/trading/news-filter.js";
process.env.LAYANX_TRADE_JOURNAL=(await import("node:path")).join((await import("node:os")).tmpdir(),"lx-journal-"+process.pid+".jsonl");   // never the owner's journal

assert.deepEqual(currenciesFor("XAUUSD_"),["USD"]);assert.deepEqual(currenciesFor("BTCUSD"),["USD"]);assert.deepEqual(currenciesFor("WTI"),["USD"]);
assert.deepEqual(currenciesFor("EURUSD_"),["EUR","USD"]);assert.deepEqual(currenciesFor("USDJPY_"),["USD","JPY"]);
const events:NewsEvent[]=[
  {title:"Non-Farm Employment Change",country:"USD",date:"2026-11-13T08:30:00-05:00",impact:"High"},
  {title:"German Trade Balance",country:"EUR",date:"2026-11-13T02:00:00-05:00",impact:"Low"},
  {title:"ECB Press Conference",country:"EUR",date:"2026-11-13T09:00:00-05:00",impact:"High"}];
// NFP is at 13:30 UTC.
assert.equal(newsBlock("XAUUSD_",new Date("2026-11-13T12:50:00Z"),events),null,"40 minutes before: still allowed");
assert.equal(newsBlock("XAUUSD_",new Date("2026-11-13T13:05:00Z"),events)?.title,"Non-Farm Employment Change");
assert.equal(newsBlock("BTCUSD",new Date("2026-11-13T13:55:00Z"),events)?.minutesAway,-25,"25 minutes after: still blocked");
assert.equal(newsBlock("XAUUSD_",new Date("2026-11-13T14:05:00Z"),events),null,"35 minutes after: allowed again");
assert.equal(newsBlock("USDJPY_",new Date("2026-11-13T13:50:00Z"),events)?.title,"Non-Farm Employment Change");
// EURUSD sees both: at 13:50 the ECB (14:00) is closer than NFP (13:30).
assert.equal(newsBlock("EURUSD_",new Date("2026-11-13T13:50:00Z"),events)?.title,"ECB Press Conference");
assert.equal(newsBlock("XAUUSD_",new Date("2026-11-13T07:00:00Z"),events),null,"low-impact news does not stop trading");

// The calendar: fetched once an hour, the saved copy used when the feed is down, nothing at all when there never was one.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-news-"));const file=path.join(dir,"calendar.json");
let calls=0,up=true,clock=1_000_000;
const fetcher=(async()=>{calls++;if(!up)throw new Error("offline");return new Response(JSON.stringify(events),{status:200});}) as unknown as typeof fetch;
const cal=new NewsCalendar(file,fetcher,()=>clock);
assert.equal((await cal.get())!.events.length,3);await cal.get();assert.equal(calls,1,"cached for an hour");
up=false;clock+=4_000_000;
const offline=await new NewsCalendar(file,fetcher,()=>clock).get();
assert.equal(offline!.fresh,false);assert.equal(offline!.events.length,3,"the last good copy");
assert.equal(await new NewsCalendar(path.join(dir,"none.json"),fetcher,()=>clock).get(),null);
fs.rmSync(dir,{recursive:true,force:true});

// The robot: around the news no order is sent; with no calendar at all it still trades (and its log says why).
{
  const {Mt5AutoScalper}=await import("../src/trading/mt5-auto-scalper.js");
  const os2=await import("node:os");const d2=fs.mkdtempSync(path.join(os2.tmpdir(),"lx-news-robot-"));
  let sent=0;
  const adapter={async connect(){return{login:1,server:"Demo",balance:1000,equity:1000,tradeMode:"demo"};},async history(){return[];},async findOrder(){return{found:false};},
    async positions(){return[];},async orders(){return[];},async getSymbolSnapshot(){throw new Error("not reached: blocked by the news first");},async placeOrder(){sent++;return{accepted:true};},dispose(){}} as any;
  const robot=new Mt5AutoScalper({adapter,statePath:path.join(d2,"s.json"),symbol:"XAUUSD",book:null,
    news:async()=>({title:"Non-Farm Employment Change",country:"USD",at:"2026-11-13T13:30:00Z",minutesAway:12}),now:()=>new Date("2026-11-13T13:18:00Z")});
  const s=await robot.checkOnce();
  assert.equal(s.lastAction,"news: Non-Farm Employment Change (USD) in 12 min; no new entry");assert.equal(sent,0);
  fs.rmSync(d2,{recursive:true,force:true});
}
console.log("news-filter: high-impact news blocks 30 min before and after for the market's currencies; calendar cached and kept");
