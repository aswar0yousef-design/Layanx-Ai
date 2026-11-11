import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {EventEmitter} from "node:events";
import {createOwnerRoutes,improvementJobFiles} from "../src/owner-routes.js";
import {ShippingDesk} from "../src/business/shipping.js";
import {ImprovementRunner} from "../src/autonomy/improvement-runner.js";
import {WhatsAppQrAdapter,type QrHandlers} from "../src/channels/whatsapp-qr.js";
import {addressFor,chooseWhatsAppPath,WhatsAppMethods} from "../src/channels/whatsapp-route.js";

const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-owner-"));
const ledgerFile=path.join(dir,"ledger.json"),intakeRoot=path.join(dir,"intake");
const available={cloud:true,qr:true};
assert.equal(chooseWhatsAppPath({available}),"cloud");
assert.equal(chooseWhatsAppPath({fallback:"qr",available}),"qr");
assert.equal(chooseWhatsAppPath({last:"qr",fallback:"cloud",available}),"qr");
assert.equal(chooseWhatsAppPath({owner:"cloud",last:"qr",available}),"cloud");
assert.equal(chooseWhatsAppPath({asked:"qr",owner:"cloud",available:{cloud:true,qr:false}}),"qr");
assert.equal(chooseWhatsAppPath({owner:"cloud",available:{cloud:false,qr:true}}),"qr");
assert.equal(chooseWhatsAppPath({owner:"qr",available:{cloud:false,qr:false}}),"qr");
assert.equal(addressFor("966500000000","qr"),"966500000000@s.whatsapp.net");
assert.equal(addressFor("966500000000@s.whatsapp.net","cloud"),"966500000000");
const methodsFile=path.join(dir,"methods.json"),methods=new WhatsAppMethods(methodsFile);
methods.set("966500000000@s.whatsapp.net","qr");
assert.equal(new WhatsAppMethods(methodsFile).get("+966500000000"),"qr");
assert.throws(()=>methods.set("abc","qr"),/invalid_number/);
assert.throws(()=>methods.set("966500000000","smoke" as any),/invalid_method/);
methods.set("966500000000",null);assert.equal(methods.get("966500000000"),undefined);

// Linked number: the owner's self chat is a command, what LayanX wrote there is not, and nothing else they send counts.
let handlers!:QrHandlers;const sent:string[]=[];
const qr=new WhatsAppQrAdapter({authDir:path.join(dir,"qr"),connector:async(_dir,h)=>{handlers=h;return{async send(_c,t){sent.push(t);},async close(){}};},minGapMs:0});
const got:any[]=[];qr.onMessage(m=>{got.push(m);});
await qr.start();handlers.onOpen("966511111111:9@s.whatsapp.net","222:9@lid");
handlers.onMessage({id:"1",chatId:"966511111111@s.whatsapp.net",senderId:"966511111111@s.whatsapp.net",text:"تقرير اليوم",fromMe:true});
assert.equal(got.length,1);assert.equal(got[0].senderId,"966511111111");assert.deepEqual(got[0].raw,{selfChat:true});
handlers.onMessage({id:"2",chatId:"222@lid",senderId:"222@lid",text:"من المعرف الخاص",fromMe:true});
assert.equal(got.length,2);assert.equal(got[1].senderId,"966511111111");
await qr.sendText("966511111111@s.whatsapp.net","الرد هنا");
handlers.onMessage({id:"3",chatId:"966511111111@s.whatsapp.net",senderId:"966511111111@s.whatsapp.net",text:"الرد هنا",fromMe:true});
assert.equal(got.length,2,"its own reply must not be answered");
handlers.onMessage({id:"4",chatId:"966522222222@s.whatsapp.net",senderId:"966522222222@s.whatsapp.net",text:"رسالة كتبتها لصديق",fromMe:true});
assert.equal(got.length,2,"what the owner writes to others is not a command");
await qr.stop();

// Self-improvement runner: refuses while work runs, refuses forbidden settings, and one at a time.
const launched:string[][]=[];let child=new EventEmitter() as any,busy=true;
const runner=new ImprovementRunner({ledgerFile,logFile:path.join(dir,"improve.log"),busy:()=>busy,launch:args=>{launched.push(args);child=new EventEmitter();return child;}});
assert.throws(()=>runner.start(),/waits_for_running_work/);
busy=false;
assert.throws(()=>runner.start({setting:"LAYANX_DEFAULT_TRUST=full"}),/not something LayanX may change/);
assert.throws(()=>runner.start({runs:50}),/invalid_runs/);
assert.throws(()=>runner.start({cases:["a;rm"]}),/invalid_case/);
assert.equal(launched.length,0);
assert.equal(runner.start({setting:"LAYANX_OLLAMA_THINK=on"}).running,true);
assert.deepEqual(launched[0]!.slice(1,3),["--ledger",ledgerFile]);assert.ok(launched[0]!.includes("--setting"));
assert.throws(()=>runner.start(),/already_running/);
child.emit("exit",0);
assert.equal(runner.status().running,false);assert.equal(runner.status().lastExit?.code,0);

const desk=new ShippingDesk(path.join(dir,"shipping.json"));
const channels={whatsappQr:new WhatsAppQrAdapter({authDir:path.join(dir,"qr2"),connector:async(_d,h)=>{h.onQr("CODE-123");return{async send(){},async close(){}};}}),methods:new WhatsAppMethods(path.join(dir,"m2.json"))} as any;
const routes=createOwnerRoutes({channels,desk,domains:{store:async()=>({orders:2}),trading:async()=>{throw new Error("no account");}},intakeRoot,ledgerFile,jobFiles:()=>[],improvement:runner});
const call=async(method:string,address:string,body:unknown={})=>{let out:any;const handled=await routes(method,new URL(address,"http://x"),async()=>body,(status,value)=>{out={...value,status};});return{handled,...out};};
assert.equal((await call("GET","/v1/channels/status")).handled,false);
assert.match((await call("POST","/v1/channels/whatsapp/qr/link",{})).error,/risk_not_accepted/);
assert.equal(channels.whatsappQr.state,"off");
const linked=await call("POST","/v1/channels/whatsapp/qr/link",{acceptRisk:true});
assert.equal(linked.status,200);assert.match(linked.qrSvg,/^<svg/);
assert.equal(JSON.stringify(channels.whatsappQr.status()).includes("CODE-123"),false,"the code stays out of status");
assert.equal((await call("POST","/v1/channels/whatsapp/qr/stop")).status,200);
assert.deepEqual((await call("POST","/v1/channels/whatsapp/methods",{number:"966500000000",method:"qr"})).methods,{"966500000000":"qr"});

await call("POST","/v1/shipping/carrier",{id:"c1",name:"ناقل",active:true,zones:{z:["جدة"]},rates:[{zone:"z",firstKg:1,firstPrice:1500,extraKgPrice:200,days:2}]});
assert.equal((await call("POST","/v1/shipping/quote",{city:"جدة",weightKg:3})).quotes[0].price,1900);
const created=(await call("POST","/v1/shipping/shipment",{orderId:"o1",customer:{name:"أ",phone:"05",city:"جدة",address:"ش"},weightKg:1,charged:2000})).shipment;
assert.match((await call("POST",`/v1/shipping/shipment/${created.id}/book`,{})).error,/tracking_number_required/);
assert.equal((await call("POST",`/v1/shipping/shipment/${created.id}/book`,{trackingNumber:"T1"})).shipment.status,"booked");
assert.equal((await call("GET",`/v1/shipping/shipment/${created.id}/invoice`)).invoice.total,2300);
assert.equal((await call("GET","/v1/shipping/report")).report.shipments,1);
assert.equal((await call("GET","/v1/shipping?status=booked")).shipments.length,1);

const brief=(await call("GET","/v1/domains/brief")).brief;
assert.equal(brief.complete,false);assert.equal(brief.store.data.orders,2);assert.equal(brief.trading.problem,"no account");
assert.equal((await call("GET","/v1/domains/route?goal="+encodeURIComponent("move the store revenue into my trading balance"))).routing.needsOwner,true);

const refused=(await call("POST","/v1/intake",{source:"git",target:"https://example.com/a.git",ref:"main",why:"x"})).record;
assert.equal(refused.status,"refused");assert.match(refused.reason,/40-character/);
assert.equal((await call("GET","/v1/intake")).records.length,1);
assert.match((await call("POST",`/v1/intake/${refused.id}/decide`,{decision:"maybe"})).error,/invalid_decision/);
assert.match((await call("POST",`/v1/intake/${refused.id}/decide`,{decision:"approved"})).error,/not_awaiting_owner/);

assert.deepEqual((await call("GET","/v1/improvement")).entries,[]);
assert.match((await call("POST","/v1/improvement/run",{setting:"MT5_LIVE_TRADING_ENABLED=true"})).error,/not something LayanX may change/);
assert.match((await call("POST","/v1/improvement/nope/rollback",{})).error,/not_kept/);
assert.equal((await call("GET","/v1/shipping/nothing")).status,404);
const runs=path.join(dir,"runs");fs.mkdirSync(path.join(runs,"a","store"),{recursive:true});fs.writeFileSync(path.join(runs,"a","store","supervisor-jobs.json"),"[]");
assert.equal(improvementJobFiles(path.join(dir,"none"),runs).length,1);
const {assertBinanceTarget}=await import("../src/trading/agent-integration.js");
assert.throws(()=>assertBinanceTarget({} as NodeJS.ProcessEnv),/test network/);
assert.throws(()=>assertBinanceTarget({BINANCE_BASE_URL:"https://api.binance.com"} as NodeJS.ProcessEnv),/BINANCE_ALLOW_REAL_MONEY/);
assertBinanceTarget({BINANCE_BASE_URL:"https://testnet.binance.vision"} as NodeJS.ProcessEnv);
assertBinanceTarget({BINANCE_ALLOW_REAL_MONEY:"true"} as NodeJS.ProcessEnv);
fs.rmSync(dir,{recursive:true,force:true});
console.log("owner routes: both WhatsApp paths route correctly, the self chat works without loops, and every owner control refuses what it should");
process.exit(0);
