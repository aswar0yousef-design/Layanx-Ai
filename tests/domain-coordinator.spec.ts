import assert from "node:assert/strict";
import {crossDomainRefusal,domainBrief,routeGoal} from "../src/autonomy/domain-coordinator.js";

assert.deepEqual(routeGoal("اعرض طلبات المتجر اليوم"),{domain:"store",agentId:"business",needsOwner:false});
assert.deepEqual(routeGoal("Show shipping costs for this week's orders"),{domain:"store",agentId:"business",needsOwner:false});
assert.deepEqual(routeGoal("ما حالة صفقات الذهب؟"),{domain:"trading",agentId:"trading-executor",needsOwner:false});
assert.deepEqual(routeGoal("start the MT5 demo scalper"),{domain:"trading",agentId:"trading-executor",needsOwner:false});
assert.deepEqual(routeGoal("لخص الأخبار"),{domain:"other",agentId:"core",needsOwner:false});
const move=routeGoal("خذ أرباح المتجر واستثمرها في تداول الذهب");
assert.equal(move.needsOwner,true);assert.equal(move.agentId,"core");
assert.equal(routeGoal("move the store revenue into my trading balance").needsOwner,true);
const both=routeGoal("قارن أداء المتجر مع التداول");
assert.equal(both.needsOwner,false);assert.match(both.reason!,/split/);
assert.equal(routeGoal("Trader Joe's store hours").domain,"store");

assert.match(crossDomainRefusal("business","trading.binance.order")!,/no access to trading/);
assert.match(crossDomainRefusal("trading-executor","commerce.products.update")!,/no access to the store/);
assert.match(crossDomainRefusal("trading-executor","shipping.quote")!,/no access to the store/);
assert.equal(crossDomainRefusal("business","commerce.products.list"),undefined);
assert.equal(crossDomainRefusal("trading-executor","trading.binance.market-data"),undefined);
assert.equal(crossDomainRefusal("coder","files.read"),undefined);

const at=()=>new Date("2026-01-01T00:00:00Z");
assert.deepEqual(await domainBrief({store:async()=>({orders:3}),trading:async()=>({pnl:1})},100,at),{at:"2026-01-01T00:00:00.000Z",store:{ok:true,data:{orders:3}},trading:{ok:true,data:{pnl:1}},complete:true});
const partial=await domainBrief({store:async()=>{throw new Error("no store connected");},trading:async()=>({pnl:1})},100,at);
assert.equal(partial.complete,false);assert.equal(partial.store.problem,"no store connected");assert.equal(partial.store.data,undefined);assert.equal(partial.trading.ok,true);
const hung=await domainBrief({store:()=>new Promise(()=>undefined),trading:async()=>({})},20,at);
assert.equal(hung.store.problem,"no answer in time");
console.log("domain-coordinator: goals reach the right side, neither side reaches the other, money does not move, and unknown stays unknown");
process.exit(0);
