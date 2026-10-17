import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {MT5_TOOLS,registerMt5TradingTools} from "../src/trading/mt5-agent-integration.js";
import {DEFAULT_MT5_MAGIC,type Mt5LiveAdapter} from "../src/trading/mt5-live-adapter.js";
import {TesterRuns,scalperAction,tradingOverview} from "../src/trading/control.js";
import {launchBrowser} from "./helpers/voice-page.js";

/**
 * The Control Center's Trading page ("why doesn't trading show?" — there was no page).
 *  Server: it reads through the MT5 tools without creating missions; it connects to MetaTrader 5 only
 *  when asked; with trading switched off it says so; acting (auto-scalper, Strategy Tester) always waits
 *  for the owner's approval, and a test runs in the background.
 *  Page: account, warnings (real account, Algo Trading off, live trading off), positions (LayanX's or
 *  the owner's), closed trades, the price line, the auto-scalper buttons with the approval flow, and the
 *  dashboard card.
 */
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-trading-"));
let connects=0;
const fake={
  running:false,
  async connect(){connects++;fake.running=true;return{login:5001,server:"Broker-Demo",balance:10000,equity:10125.5,currency:"USD",leverage:100,tradeMode:"demo",tradeAllowed:true,terminalConnected:true};},
  async positions(){return[{ticket:"1",symbol:"XAUUSD",side:"buy",quantity:0.1,price:2400.5,stopLoss:2395,takeProfit:2410,profit:12.5,magic:DEFAULT_MT5_MAGIC},{ticket:"2",symbol:"EURUSD",side:"sell",quantity:0.5,price:1.08,profit:-3.2,magic:0}];},
  async getSymbolSnapshot(symbol:string){return{symbol,bid:2401.1,ask:2401.4,timestamp:new Date().toISOString()};},
  async getCandles(r:{limit:number}){return Array.from({length:r.limit},(_,i)=>({timestamp:new Date(Date.now()-(r.limit-i)*900_000).toISOString(),open:2390+i,high:2391+i,low:2389+i,close:2390+i*0.2}));},
  async history(){return[{ticket:"9",positionId:"9",symbol:"XAUUSD",closedAt:"2026-10-16T10:00:00",quantity:0.1,price:2399,profit:20,commission:-1,swap:0,magic:DEFAULT_MT5_MAGIC,comment:""},
    {ticket:"10",positionId:"10",symbol:"XAUUSD",closedAt:"2026-10-16T12:00:00",quantity:0.1,price:2398,profit:-5,commission:-1,swap:0,magic:0,comment:""}];},
  async orders(){return[];},
  async terminalInfo(){return{path:"",dataPath:"",connected:true};}
};
const core=new LayanXCore();
core.registerAgent({agentId:"core",purpose:"trading page",allowedTools:[...MT5_TOOLS],forbiddenResources:[],requiredPermission:"L4_EXECUTE",maxToolCalls:10,maxRuntimeMs:10000,successCriteria:["done"],stopCondition:"stop"});
const scalper=registerMt5TradingTools(core.tools,core.toolAdapters,{adapter:fake as unknown as Mt5LiveAdapter,statePath:path.join(dir,"scalper.json")});

// ---------- server
{
  const before=core.missions.list().length;
  const idle=await tradingOverview(core,{connect:false}) as any;
  assert.equal(idle.enabled,true);assert.equal(idle.connected,false);assert.equal(connects,0,"opening the page does not start MetaTrader 5");
  assert.equal(idle.scalper.ok,true);assert.equal(idle.scalper.value.running,false);
  const live=await tradingOverview(core,{connect:true,symbol:"XAUUSD",days:7}) as any;
  assert.equal(live.connected,true);assert.equal(live.account.value.tradeMode,"demo");
  assert.equal(live.positions.value.count,2);assert.equal(live.quote.value.spread,0.3);
  assert.equal(live.series.value.closes.length,96,"24 hours of M15 closes");
  assert.equal(live.history.value.count,2);assert.equal(live.history.value.net,13);
  assert.equal(live.settings.maxConsecutiveLosses,3);assert.equal(live.settings.liveTrading,false);
  assert.equal(core.missions.list().length,before,"reading creates no missions");
  assert.equal((await tradingOverview(core,{connect:true,symbol:"bad symbol;rm"}) as any).symbol,"XAUUSD","a bad symbol is not passed on");

  // Acting waits for the owner every time.
  const ask=await scalperAction(core,"default","start");
  assert.ok(!ask.ok&&ask.approvalId,"starting asks for approval");
  assert.equal(scalper.status().running,false,"nothing started before the approval");
  core.executionRuntime.approvals.approve(ask.approvalId!);
  process.env.MT5_AUTO_SCALPING_ENABLED="true";
  const started=await scalperAction(core,"default","start",{missionId:ask.missionId!,approvalId:ask.approvalId!});
  assert.equal(started.ok,true,JSON.stringify(started));assert.equal(scalper.status().running,true);
  const askStop=await scalperAction(core,"default","stop");assert.ok(askStop.approvalId);
  core.executionRuntime.approvals.approve(askStop.approvalId!);
  await scalperAction(core,"default","stop",{missionId:askStop.missionId!,approvalId:askStop.approvalId!});
  assert.equal(scalper.status().running,false);
  delete process.env.MT5_AUTO_SCALPING_ENABLED;

  // The Strategy Tester: approval first; then it starts in the background and its result is kept.
  const runs=new TesterRuns();
  const payload={expert:"MyRobot",symbol:"XAUUSD",period:"H1",from:"2025-01-01",to:"2025-12-31"};
  const testAsk=await runs.request(core,"default",payload) as any;
  assert.ok(testAsk.approvalId);assert.equal(runs.list().length,0);
  core.executionRuntime.approvals.approve(testAsk.approvalId);
  const t0=Date.now();
  const startedTest=await runs.request(core,"default",payload,{missionId:testAsk.missionId,approvalId:testAsk.approvalId}) as any;
  assert.equal(startedTest.started,true);assert.ok(Date.now()-t0<3000,"returns at once");
  for(let i=0;i<100&&runs.list()[0]!.status==="running";i++)await new Promise(r=>setTimeout(r,50));
  assert.equal(runs.list()[0]!.status,"failed","no tester terminal here: it fails with a reason, it does not hang");
  assert.ok(runs.list()[0]!.error);

  // Trading switched off on the setup page.
  process.env.LAYANX_CAPABILITIES="coding";
  assert.deepEqual(Object.keys(await tradingOverview(core,{connect:true})).sort(),["enabled","settings"]);
  await assert.rejects(scalperAction(core,"default","start"),/switched off/);
  delete process.env.LAYANX_CAPABILITIES;
}

// ---------- page
const WEB=path.resolve("web");
const state={connected:false,running:false,calls:[] as string[],approved:0,real:false};
const overview=(connect:boolean)=>{
  const base={ok:true,enabled:true,settings:{liveTrading:false,autoScalping:true,allowReal:false,maxDailyLossPct:2,maxTradesPerDay:20,maxConsecutiveLosses:3,magic:DEFAULT_MT5_MAGIC},
    scalper:{ok:true,value:{running:state.running,symbol:"XAUUSD",timeframe:"M1",tradesToday:4,dailyPnl:-12.5,consecutiveLosses:1,lastAction:"no signal; waiting"}}};
  if(!connect)return{...base,connected:false};
  return{...base,connected:true,symbol:"XAUUSD",days:7,
    account:{ok:true,value:{login:1,server:"Broker-Live",balance:10000,equity:10125.5,currency:"USD",leverage:100,tradeMode:state.real?"real":"demo",tradeAllowed:false}},
    positions:{ok:true,value:{count:2,positions:[{ticket:"1",symbol:"XAUUSD",side:"buy",quantity:0.1,price:2400.5,profit:12.5,magic:DEFAULT_MT5_MAGIC},{ticket:"2",symbol:"EURUSD",side:"sell",quantity:0.5,price:1.08,profit:-3.2,magic:0}]}},
    quote:{ok:true,value:{symbol:"XAUUSD",bid:2401.1,ask:2401.4,spread:0.3}},series:{ok:true,value:{symbol:"XAUUSD",closes:[1,2,3,2.5,4]}},
    history:{ok:true,value:{count:2,net:13,wins:1,losses:1,deals:[{closedAt:"2026-10-16T12:00:00",symbol:"XAUUSD",quantity:0.1,profit:-5,commission:-1,swap:0,magic:0}]}}};
};
const srv=http.createServer((req,res)=>{const c:Buffer[]=[];req.on("data",x=>c.push(x));req.on("end",()=>{
  const url=new URL(req.url??"/","http://x");const send=(d:unknown,code=200)=>{res.writeHead(code,{"content-type":"application/json"});res.end(JSON.stringify(d));};
  if(url.pathname==="/"){res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(fs.readFileSync(path.join(WEB,"index.html")));return;}
  if(url.pathname==="/app.js"||url.pathname==="/styles.css"){res.writeHead(200,{"content-type":url.pathname.endsWith(".js")?"text/javascript":"text/css"});res.end(fs.readFileSync(path.join(WEB,url.pathname.slice(1))));return;}
  if(url.pathname==="/v1/setup/status")return send({owner:{name:"Owner"},workspace:{root:"C:\\LayanX-Projects",projects:["default"],linked:[]},capabilities:{},secrets:{names:[]}});
  if(url.pathname==="/v1/trading/overview"){const connect=url.searchParams.get("connect")==="1";state.calls.push("overview:"+(connect?1:0));if(connect)state.connected=true;return send(overview(connect));}
  if(url.pathname==="/v1/trading/tester"&&req.method==="GET")return send({ok:true,runs:[]});
  if(url.pathname==="/v1/trading/scalper/start"){const b=JSON.parse(Buffer.concat(c).toString()||"{}");state.calls.push("start:"+(b.approvalId?"approved":"ask"));
    if(!b.approvalId)return send({ok:false,approvalId:"ap-1",missionId:"m-1"});state.running=true;return send({ok:true,data:{running:true}});}
  if(url.pathname.startsWith("/v1/approvals/ap-1/approve")){state.approved++;return send({ok:true});}
  if(url.pathname==="/v1/approvals")return send({ok:true,approvals:[]});
  if(url.pathname==="/v1/missions")return send({ok:true,missions:[]});
  if(url.pathname==="/v1/supervisor/jobs")return send({ok:true,jobs:[]});
  send({},404);});});
await new Promise<void>(r=>srv.listen(0,"127.0.0.1",()=>r()));
const base=`http://127.0.0.1:${(srv.address() as {port:number}).port}`;
const browser=await launchBrowser([]);
if(!browser)console.log("trading-page: page part skipped (no browser)");
else try{
  const page=await browser.newPage({viewport:{width:1400,height:1000}});const errors:string[]=[];page.on("pageerror",(e:any)=>errors.push(String(e)));
  const dialogs:string[]=[];page.on("dialog",async(dlg:any)=>{dialogs.push(dlg.message());await dlg.accept();});
  await page.addInitScript(`try{localStorage.setItem("lx.cc.lang","ar")}catch(e){}`);
  // The dashboard shows trading.
  await page.goto(base+"/#dashboard");await page.waitForSelector(".cap-trade",{timeout:15000});
  assert.match(await page.$eval(".cap-trade",(e:HTMLElement)=>e.innerText),/التداول[\s\S]*المضارب الآلي: متوقف/);
  // The page: not connected yet, nothing started; one click connects.
  await page.click(".cap-trade");await page.waitForSelector("#view h1");
  assert.equal(await page.$eval("#view h1",(e:HTMLElement)=>e.innerText),"التداول");
  assert.ok(!state.calls.includes("overview:1"),"opening the page does not connect by itself");
  await page.getByText("اتصل بـ MetaTrader 5").click();
  await page.waitForSelector("#trAccount .stats");
  const text=await page.$eval("#view",(e:HTMLElement)=>e.innerText);
  for(const s of ["تجريبي","10,125.5","1:100","مطفأ","زر Algo Trading مطفأ","التداول الحي مطفأ","XAUUSD","EURUSD","LayanX","أنت","2,401.1","الصفقات المغلقة","اختبار الروبوتات"])
    assert.ok(text.includes(s),"shows "+s+":\n"+text.slice(0,1500));
  assert.ok(await page.$("#trQuote svg.tr-line path.up"),"the price line is drawn");
  // Start the auto-scalper: asked, approved by the owner here, then started.
  await page.locator("#trScalper button",{hasText:"تشغيل"}).click();
  await page.waitForFunction(()=>document.querySelector("#trScalper")?.textContent?.includes("يعمل"),null,{timeout:8000});
  assert.deepEqual(state.calls.filter(c=>c.startsWith("start")),["start:ask","start:approved"]);assert.equal(state.approved,1);
  assert.equal(dialogs.length,1);assert.match(dialogs[0]!,/تشغيل المضارب الآلي على XAUUSD في حساب تجريبي/);
  // A real account is flagged.
  state.real=true;await page.getByText("تحديث").click();
  await page.waitForFunction(()=>document.querySelector("#trAccount")?.textContent?.includes("حساب حقيقي"),null,{timeout:8000});
  assert.deepEqual(errors,[]);
}finally{await browser.close();}
srv.close();scalper.stop();fs.rmSync(dir,{recursive:true,force:true});
console.log("trading-page: the Trading page reads MT5 without missions, connects only when asked, and acts only with approval");
process.exit(0);
