import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {Mt5LiveAdapter,Mt5UnknownOutcomeError,Mt5BridgeError,mt5Settings,DEFAULT_MT5_MAGIC} from "../src/trading/mt5-live-adapter.js";
import {ToolRegistry} from "../src/tools/registry.js";
import {ToolAdapterRegistry} from "../src/tools/adapters.js";
import {registerMt5TradingTools,MT5_TOOLS} from "../src/trading/mt5-agent-integration.js";

// The MT5 bridge against a stand-in MetaTrader5 package (tests/fixtures/mt5fake): one long-lived Python
// process, no LayanX secrets in it, the filling mode the symbol accepts, demo-only unless the owner allows
// real, an order never sent twice, a slow answer checked on the account, and only LayanX's positions closed.
const root=fileURLToPath(new URL("..",import.meta.url));
const python=process.env.LAYANX_PYTHON??(process.platform==="win32"?"python":"python3");
let hasPython=false;try{execFileSync(python,["--version"],{stdio:"ignore"});hasPython=true;}catch{}

// Settings (no Python needed).
assert.deepEqual(mt5Settings({}),{deviation:20,magic:DEFAULT_MT5_MAGIC,allowReal:false});
assert.deepEqual(mt5Settings({MT5_MAX_DEVIATION_POINTS:"99999",MT5_MAGIC_NUMBER:"7",MT5_ALLOW_REAL_ACCOUNT:"true"}),{deviation:1000,magic:7,allowReal:true});
assert.equal(mt5Settings({MT5_ALLOW_REAL_ACCOUNT:"yes"}).allowReal,false,"only the exact word true");
assert.deepEqual(mt5Settings({MT5_MAGIC_NUMBER:"",MT5_MAX_DEVIATION_POINTS:" "}),{deviation:20,magic:DEFAULT_MT5_MAGIC,allowReal:false},"empty settings keep the defaults");

if(!hasPython){console.log("mt5-bridge: skipped (no python)");process.exit(0);}

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-mt5-"));
const stateFile=path.join(dir,"state.json");
const write=(s:Record<string,unknown>)=>fs.writeFileSync(stateFile,JSON.stringify(s));
const read=()=>JSON.parse(fs.readFileSync(stateFile,"utf8")) as Record<string,any>;
const env={PYTHONPATH:path.join(root,"tests","fixtures","mt5fake"),FAKE_MT5_STATE:stateFile,PYTHONIOENCODING:"utf-8"};
const bridgePath=path.join(root,"scripts","mt5-bridge.py");
for(const k of ["LAYANX_MT5_LOGIN","LAYANX_MT5_PASSWORD","LAYANX_MT5_SERVER","LAYANX_MT5_TERMINAL_PATH","MT5_ALLOW_REAL_ACCOUNT"])delete process.env[k];
process.env.LAYANX_SECRET_VAULT_PATH=path.join(dir,"no-vault.json");
process.env.ANTHROPIC_API_KEY=["sk","ant","not-a-real-key"].join("-");
process.env.MT5_LIVE_TRADING_ENABLED="true";

// 1. Attach to the open terminal (no password stored), one process for many calls, no secrets in it.
write({trade_mode:0,filling_mode:1});
const mt5=new Mt5LiveAdapter({bridgePath,env,timeoutMs:20000});
const account=await mt5.connect();
assert.deepEqual({mode:account.tradeMode,allowed:account.tradeAllowed,login:account.login,currency:account.currency},{mode:"demo",allowed:true,login:5551234,currency:"USD"});
await mt5.getSymbolSnapshot("XAUUSD");await mt5.positions();
const candles=await mt5.getCandles({symbol:"XAUUSD",timeframe:"M1",limit:5});
assert.equal(candles.length,5);
assert.equal(read().initialize_calls,1,"the terminal connection is made once, not before every request");
assert.deepEqual(read().last_initialize,{path:null,login:null,password:false,server:null},"no password: the logged-in terminal is used");
assert.equal(read().secret_in_env,false,"the bridge process does not get LayanX secrets");
assert.equal((await mt5.getSymbolSpecification("XAUUSD")).accountType,"demo","not always \"live\"");
await assert.rejects(mt5.getCandles({symbol:"XAUUSD",timeframe:"M7",limit:5}),/Unsupported MT5 timeframe/);
await assert.rejects(mt5.getSymbolSnapshot("NOPE"),(e:unknown)=>e instanceof Mt5BridgeError&&/symbol_select failed/.test(e.message));
assert.deepEqual(await mt5.terminalInfo(),{path:"C:\\Program Files\\MetaTrader 5",dataPath:"C:\\Users\\me\\AppData\\Roaming\\MetaQuotes\\Terminal\\ABC",connected:true});

// 2. The filling mode is the one the symbol accepts (FOK-only gold used to fail with IOC).
const first=await mt5.placeOrder({symbol:"XAUUSD",side:"long",quantity:0.01,stopLossPrice:2390,takeProfitPrice:2420,clientOrderId:"t-fok-1"});
assert.equal(first.accepted,true,JSON.stringify(first));
assert.equal(read().sends.at(-1).type_filling,0,"FOK");
assert.equal(read().sends.at(-1).comment,"LX:t-fok-1","the order carries its tag");
assert.equal(read().sends.at(-1).magic,DEFAULT_MT5_MAGIC);
assert.equal(read().checks.length,1,"order_check before order_send");
write({...read(),filling_mode:2});
await mt5.placeOrder({symbol:"EURUSD",side:"short",quantity:0.01,clientOrderId:"t-ioc-1"});
assert.equal(read().sends.at(-1).type_filling,1,"IOC");

// 3. The same tag twice: not sent again.
const sendsBefore=read().sends.length;
const again=await mt5.placeOrder({symbol:"XAUUSD",side:"long",quantity:0.01,clientOrderId:"t-fok-1"});
assert.deepEqual({accepted:again.accepted,replayed:again.replayed,id:again.brokerOrderId},{accepted:true,replayed:true,id:first.brokerOrderId});
assert.equal(read().sends.length,sendsBefore,"no second order");
await assert.rejects(mt5.placeOrder({symbol:"XAUUSD",side:"long",quantity:0.01,clientOrderId:"bad id with spaces"}),/clientOrderId/);

// 4. A real account is refused unless the owner allows it; Algo Trading off is refused.
write({...read(),trade_mode:2});
await assert.rejects(mt5.placeOrder({symbol:"XAUUSD",side:"long",quantity:0.01}),(e:unknown)=>e instanceof Mt5BridgeError&&/REAL account.*MT5_ALLOW_REAL_ACCOUNT=true/.test(e.message),"an explicit no: not an unknown outcome");
process.env.MT5_ALLOW_REAL_ACCOUNT="true";
assert.equal((await mt5.placeOrder({symbol:"XAUUSD",side:"short",quantity:0.01})).accepted,true);
delete process.env.MT5_ALLOW_REAL_ACCOUNT;
write({...read(),trade_mode:0,terminal_trade_allowed:false});
await assert.rejects(mt5.placeOrder({symbol:"XAUUSD",side:"long",quantity:0.01}),/Algo Trading is turned off/);
write({...read(),terminal_trade_allowed:true,market_closed:true});
await assert.rejects(mt5.placeOrder({symbol:"XAUUSD",side:"long",quantity:0.01}),/market may be closed/);
write({...read(),market_closed:false});

// 5. Only LayanX's own positions are closed; a close goes through order_check too.
const s5=read();s5.positions.push({ticket:777,symbol:"XAUUSD",type:0,volume:0.05,price_open:2399,sl:0,tp:0,profit:3,magic:0,comment:"manual",time:1760000000});write(s5);
await assert.rejects(mt5.closePosition("777"),/not opened by LayanX/);
const mine=(await mt5.positions("XAUUSD")).find(p=>p.comment==="LX:t-fok-1")!;
assert.equal(mine.magic,DEFAULT_MT5_MAGIC);
const closed=await mt5.closePosition(mine.ticket);
assert.equal(closed.accepted,true);
assert.equal(read().checks.at(-1).position,Number(mine.ticket),"order_check before the close");
// A LayanX position closed by hand (the closing deal has magic 0) still counts as a LayanX trade.
const euro=(await mt5.positions("EURUSD")).find(p=>p.comment==="LX:t-ioc-1")!;
const s5b=read();s5b.positions=s5b.positions.filter((p:any)=>String(p.ticket)!==euro.ticket);
s5b.deals.push({ticket:9001,order:9001,position_id:Number(euro.ticket),symbol:"EURUSD",type:0,entry:1,time:1760000500,volume:0.01,price:1.1,profit:2.5,commission:0,swap:0,magic:0,comment:"closed by hand"});
s5b.deals.push({ticket:9002,order:9002,position_id:777,symbol:"XAUUSD",type:1,entry:1,time:1760000600,volume:0.05,price:2401,profit:9,commission:0,swap:0,magic:0,comment:"manual trade"});write(s5b);
const history=await mt5.history({days:2,onlyLayanX:true});
assert.deepEqual(history.map(d=>[d.positionId,d.profit]),[[mine.ticket,-5],[euro.ticket,2.5]],"LayanX trades (also one closed by hand), in ticket order; the manual trade is not one");
assert.equal((await mt5.history({days:2})).length,3,"without the filter: every closed trade");
write({...read(),history_none:true});
await assert.rejects(mt5.history(),/history_deals_get failed/);
write({...read(),history_none:false});

// 6. A slow answer: the order is on the account, so it is reported as done (and not sent again).
write({...read(),order_delay:4});
const slow=new Mt5LiveAdapter({bridgePath,env,timeoutMs:20000,orderTimeoutMs:2500});
await slow.connect();// the process is running before the order's time limit starts
const confirmed=await slow.placeOrder({symbol:"XAUUSD",side:"long",quantity:0.02,clientOrderId:"t-slow-1"});
assert.deepEqual({accepted:confirmed.accepted,msg:confirmed.message},{accepted:true,msg:"confirmed on the account after the answer was lost"});
assert.equal(read().sends.filter((x:any)=>x.comment==="LX:t-slow-1").length,1);
// A quick read sent while an order is in progress waits for it: its time limit starts when it is sent,
// so it cannot time out behind the order and kill it (the review found an open order reported as failed).
write({...read(),order_delay:2});
const shared=new Mt5LiveAdapter({bridgePath,env,timeoutMs:1500,orderTimeoutMs:10000});
await shared.connect();
const [orderResult,quote]=await Promise.all([shared.placeOrder({symbol:"XAUUSD",side:"long",quantity:0.01,clientOrderId:"t-shared-1"}),shared.getSymbolSnapshot("XAUUSD")]);
assert.equal(orderResult.accepted,true);assert.equal(orderResult.message,"Request executed");assert.equal(quote.bid,2400);
// The bridge closed while an order is in progress (LayanX shutting down): checked on the account, not "failed".
const closing=shared.placeOrder({symbol:"XAUUSD",side:"short",quantity:0.01,clientOrderId:"t-closed-1"});
await new Promise(r=>setTimeout(r,700));shared.dispose();
const afterClose=await closing;
assert.deepEqual({accepted:afterClose.accepted,msg:afterClose.message},{accepted:true,msg:"confirmed on the account after the answer was lost"});
assert.equal(read().sends.filter((x:any)=>x.comment==="LX:t-closed-1").length,1);
shared.dispose();
// ...and when it is not on the account: the outcome is unknown, not "failed".
write({...read(),order_delay:0});
const lost=new Mt5LiveAdapter({bridgePath,env,timeoutMs:20000,orderTimeoutMs:1});
await assert.rejects(lost.placeOrder({symbol:"XAUUSD",side:"long",quantity:0.01,clientOrderId:"t-lost-1"}),(e:unknown)=>e instanceof Mt5UnknownOutcomeError&&e.clientOrderId==="t-lost-1");
slow.dispose();lost.dispose();

// 6b. No result from order_send: unknown (looked up), not "not sent". A cancelled order is never written.
write({...read(),order_none:true});
await assert.rejects(mt5.placeOrder({symbol:"XAUUSD",side:"long",quantity:0.01,clientOrderId:"t-none-1"}),(e:unknown)=>e instanceof Mt5UnknownOutcomeError&&/no result/.test(e.message));
write({...read(),order_none:false});
const sendsNow=read().sends.length;
await assert.rejects(mt5.placeOrder({symbol:"XAUUSD",side:"long",quantity:0.01},{beforeSend:()=>false}),(e:unknown)=>e instanceof Mt5BridgeError&&/cancelled before it reached/.test(e.message));
assert.equal(read().sends.length,sendsNow,"nothing sent");
assert.deepEqual(await mt5.orders("XAUUSD"),[]);

// 7. The tools: read-only ones answer, the summaries add up.
const tools=new ToolRegistry();const adapters=new ToolAdapterRegistry();
registerMt5TradingTools(tools,adapters,{adapter:mt5,statePath:path.join(dir,"scalper.json")});
assert.deepEqual(MT5_TOOLS.filter(n=>!tools.list().some(t=>t.name===n)),[]);
const run=(name:string,payload:Record<string,unknown>={})=>adapters.get(name)!.execute({tool:name,payload} as any) as Promise<any>;
assert.equal((await run("trading.mt5.quote",{symbol:"XAUUSD"})).spread,0.3);
assert.ok((await run("trading.mt5.positions")).count>=2);
const hist=await run("trading.mt5.history",{days:3});
assert.deepEqual([hist.count,hist.net,hist.wins,hist.losses],[3,6.5,2,1]);
await assert.rejects(run("trading.mt5.quote",{}),/payload.symbol is required/);
await assert.rejects(run("trading.mt5.candles",{symbol:"XAU USD"}),/symbol must be/);
assert.equal((await run("trading.mt5.candles",{symbol:"XAUUSD",limit:9999})).count,500,"capped");
for(const name of MT5_TOOLS){const def=tools.list().find(t=>t.name===name)!;assert.equal(def.dangerous,def.permission==="L4_EXECUTE",name+": only L4 tools wait for approval");}
mt5.dispose();

// 8. Without the MetaTrader5 package the error says what to install. (A stand-in that fails to import:
//    on the owner's PC the real package is installed and must not be started by a test.)
const missing=new Mt5LiveAdapter({bridgePath,timeoutMs:20000,env:{PYTHONPATH:path.join(root,"tests","fixtures","mt5missing")}});
await assert.rejects(missing.connect(),/MetaTrader5 Python package is required/);
missing.dispose();

// 8b. Stored login with an Arabic server name: it reaches the terminal intact (the pipe is not the code page).
process.env.LAYANX_MT5_LOGIN="5551234";process.env.LAYANX_MT5_PASSWORD="كلمة-سر";process.env.LAYANX_MT5_SERVER="وسيط-تجريبي";
const named=new Mt5LiveAdapter({bridgePath,env,timeoutMs:20000});
await named.connect();
assert.deepEqual(read().last_initialize,{path:null,login:5551234,password:true,server:"وسيط-تجريبي"});
assert.equal(read().initialize_password,"كلمة-سر");
named.dispose();
for(const k of ["LAYANX_MT5_LOGIN","LAYANX_MT5_PASSWORD","LAYANX_MT5_SERVER"])delete process.env[k];

// 9. Live trading switched off: nothing is started at all.
process.env.MT5_LIVE_TRADING_ENABLED="false";
await assert.rejects(new Mt5LiveAdapter({bridgePath,env}).placeOrder({symbol:"XAUUSD",side:"long",quantity:0.01}),/live execution is disabled/);
fs.rmSync(dir,{recursive:true,force:true});
console.log("mt5-bridge: one process, no secrets, filling per symbol, demo-only by default, no duplicate orders, slow answers checked, own positions only");
process.exit(0);
