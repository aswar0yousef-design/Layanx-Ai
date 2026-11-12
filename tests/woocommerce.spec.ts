import assert from "node:assert/strict";
import {WooClient,applyChange,parseChange,planChange,reportDays,storeChangeRequest,storeReport,storeReportRequest,wooBase,wooConfig,numberInRequest} from "../src/business/woocommerce.js";
import {storeReply,storeChangeReply} from "../src/core/task-answer.js";
import {startFakeWoo} from "./fixtures/fake-woocommerce.js";

// The address the owner types becomes the REST base, and the keys only travel encrypted (or stay on this computer).
assert.equal(wooBase("mystore.com"),"https://mystore.com/wp-json/wc/v3");
assert.equal(wooBase("https://mystore.com/shop/"),"https://mystore.com/shop/wp-json/wc/v3");
assert.equal(wooBase("https://mystore.com/wp-json/wc/v3/"),"https://mystore.com/wp-json/wc/v3");
assert.throws(()=>wooBase("http://mystore.com"),/https/);
assert.equal(wooConfig({LAYANX_WOOCOMMERCE_URL:"x.com"} as any),null,"no keys: not connected");

// Which requests are a report and which are a change.
assert.ok(storeReportRequest("كم طلب جاني اليوم في متجري؟"));
assert.ok(storeReportRequest("ما المنتجات التي نفد مخزونها في المتجر"));
assert.ok(storeReportRequest("ما المنتجات غير المتوفرة في مخزون متجري"),"غير as 'not' is not a change");
assert.ok(storeReportRequest("how were sales in my store this week?"));
assert.ok(!storeReportRequest("ابن لي موقع متجر للعطور"),"building a store page is a project, not a report");
assert.ok(storeChangeRequest("خفض سعر العسل في متجري إلى 40"));
assert.ok(storeChangeRequest("اجعل الطلب رقم 1041 مكتمل في المتجر"));
assert.ok(!storeChangeRequest("كم طلب اليوم في متجري"));
assert.equal(reportDays("مبيعات اليوم"),1);assert.equal(reportDays("مبيعات هذا الأسبوع"),7);assert.equal(reportDays("آخر 14 يوم"),14);assert.equal(reportDays("this month"),30);
assert.ok(numberInRequest("40","خفض السعر إلى ٤٠ ريال"),"Arabic digits count");
assert.ok(!numberInRequest("39","خفض السعر إلى 40"));

const now=new Date();
const store=await startFakeWoo({now});
try{
  const client=new WooClient({url:store.url,key:"ck_test",secret:"cs_test",allowWrites:false});
  // Wrong keys: a clear message, not a crash.
  await assert.rejects(new WooClient({url:store.url,key:"bad",secret:"bad",allowWrites:false}).status(),/refused the keys \(401 woocommerce_rest_cannot_view\)/);
  await assert.rejects(new WooClient({url:store.url+"/not-wp",key:"ck_test",secret:"cs_test",allowWrites:false}).status(),/rest_no_route/);
  const status=await client.status();
  assert.equal(status.products,229,"the default product list is the published ones");
  assert.ok(!store.requests.some(r=>/consumer_key|consumer_secret/.test(r.path)),"the keys never go in the address");

  // Every page is read: 230 products are 3 pages of 100.
  assert.equal((await client.products()).length,230);
  const report=await storeReport(client,1,now);
  assert.equal(report.orders,5,"only today's orders");
  assert.deepEqual(report.byStatus,{processing:2,completed:1,pending:1,cancelled:1});
  assert.deepEqual(report.revenue,{SAR:183},"paid only: 90 + 30 + 63; pending and cancelled are not money in");
  assert.deepEqual(report.toShip.map(o=>o.number),["1041","1045"]);
  assert.deepEqual(report.top[0],{name:"عسل سدر يمني 500 جرام",quantity:3});
  assert.deepEqual(report.outOfStock,["بن يمني حراز 250 جرام"],"a draft product is not reported");
  assert.deepEqual(report.lowStock,[{name:"زيت سمسم بلدي",left:2}]);
  const week=await storeReport(client,7,now);
  assert.equal(week.orders,6);assert.deepEqual(week.revenue,{SAR:483});
  const text=storeReply(report,true)!;
  assert.match(text,/5 طلب، والمبيعات المدفوعة 183 SAR/);
  assert.match(text,/#1041: 90.00 SAR — الرياض/);
  assert.match(text,/نفد مخزونها: بن يمني حراز/);

  // Writes are off until the owner turns them on.
  const goal="خفض سعر العسل السدر في متجري إلى 40";
  const think=async()=>JSON.stringify({kind:"product",n:1,regular_price:"40"});
  const plan=await planChange(goal,client,think);
  await assert.rejects(applyChange(plan,client),/Changing the store is off/);
  assert.equal(store.products[0].regular_price,"45");

  const writer=new WooClient({url:store.url,key:"ck_test",secret:"cs_test",allowWrites:true});
  const done=await applyChange(await planChange(goal,writer,think),writer);
  assert.equal(done.verified,true);assert.equal(store.products[0].regular_price,"40","the store really holds the new price");
  assert.match(storeChangeReply(done,true)!,/السعر كان 45 وصار 40/);

  // A guessed number or an unnamed product never reaches the store.
  const products=await writer.products();
  assert.throws(()=>parseChange({kind:"product",n:1,regular_price:"39"},goal,products),/not in the request/);
  assert.throws(()=>parseChange({kind:"product",n:2,regular_price:"40"},goal,products),/Which product/,"the model picked the coffee; the request names the honey");
  // Orders: completed is fine; cancelling or refunding is the owner's (money).
  const orderPlan=parseChange({kind:"order",order:"1041",order_status:"completed"},"اجعل الطلب رقم 1041 مكتمل في المتجر",products);
  const shipped=await applyChange(orderPlan,writer);
  assert.deepEqual([shipped.before,shipped.after,shipped.verified],["processing","completed",true]);
  assert.throws(()=>parseChange({kind:"order",order:"1045",order_status:"cancelled"},"الغ الطلب 1045 في المتجر",products),/Cancelling and refunds/);
  await assert.rejects(writer.setOrderStatus(505,"refunded"),/moves the customer's money/);

  // Read-only keys: the store refuses, and the owner is told why.
  const ro=await startFakeWoo({now,readOnly:true});
  try{await assert.rejects(new WooClient({url:ro.url,key:"ck_test",secret:"cs_test",allowWrites:true}).updateProduct(11,{regular_price:"40"}),/Read\/Write/);}finally{await ro.close();}

  // Adding a product twice (a retry) never makes two; a new one starts as a draft.
  const first=await writer.upsertProduct({name:"تمر خلاص",sku:"DATES-1",regular_price:"22"});
  const again=await writer.upsertProduct({name:"تمر خلاص",sku:"DATES-1",regular_price:"22"});
  assert.equal(first.created,true);assert.equal(again.created,false);assert.equal(first.product.status,"draft");
  assert.equal(store.products.filter(p=>p.sku==="DATES-1").length,1);
}finally{await store.close();}
console.log("woocommerce: reads every page, reports today's paid sales and stock, changes only what the owner named and reads it back, never refunds");
{
  // Store questions are tasks that read the store, never a chat answer with invented numbers.
  const {routeRequest}=await import("../src/voice/request-router.js");
  for(const t of ["كم طلب جاني اليوم في متجري؟","ما المنتجات التي نفد مخزونها في المتجر","خفض سعر العسل في متجري إلى 40","how were sales in my store this week?","عطني ملخص مبيعات متجري هذا الشهر"])
    assert.equal(routeRequest(t).route,"task",t);
  assert.equal(routeRequest("ابن لي متجر عطور").route,"project-build");
  assert.equal(routeRequest("ما هو ووكومرس؟").route,"answer","a general question stays a conversation");
  console.log("woocommerce: store questions are routed to the store tools");
}
{
  // The planner sends store questions straight to store.report and changes to store.change; no model guesses the tool.
  const {AiMissionPlanner}=await import("../src/core/ai-planner.js");
  const planner=new AiMissionPlanner({execute:async()=>{throw new Error("no model should be asked");}} as any);
  const catalog=[{name:"store.report",description:"",permission:"L1_READ",dangerous:false,actions:["store report"],tags:[]},{name:"store.change",description:"",permission:"L4_EXECUTE",dangerous:true,actions:["change store"],tags:[]}] as any;
  assert.equal((await planner.plan("كم طلب جاني اليوم في متجري؟",catalog)).tools[0]!.tool,"store.report");
  const change=await planner.plan("خفض سعر العسل في متجري إلى 40",catalog);
  assert.equal(change.tools[0]!.tool,"store.change");assert.deepEqual(change.successCriteria,["result.verified === true"]);
  console.log("woocommerce: the planner picks the store tools without a model");
}
{
  // Seen live: given 230 products a 7B model answered with the wrong number. Code narrows to the products the request names.
  const {namedProducts}=await import("../src/business/woocommerce.js");
  const {sampleCatalog}=await import("./fixtures/fake-woocommerce.js");
  const all=sampleCatalog().products;
  assert.deepEqual(namedProducts(all,"خفّض سعر عسل السدر في متجري إلى 40 ريال").map(p=>p.id),[11]);
  assert.deepEqual(namedProducts(all,"حدث مخزون SESAME-1L في المتجر إلى 9").map(p=>p.id),[13]);
  assert.deepEqual(namedProducts(all,"خفض سعر المنتج في متجري إلى 5"),[],"no product named");
  const one=parseChange({kind:"product",n:7,regular_price:"40"},"خفّض سعر عسل السدر إلى 40",namedProducts(all,"خفّض سعر عسل السدر إلى 40"));
  assert.equal(one.product!.id,11,"one named product: the model's number does not matter");
  console.log("woocommerce: the product is found from the owner's words before the model is asked");
}
{
  // Order changes are read by code (seen live: the model called "make order 1045 completed" a product change).
  const {orderChangeFrom}=await import("../src/business/woocommerce.js");
  assert.deepEqual(orderChangeFrom("اجعل الطلب رقم 1045 مكتمل في متجري"),{kind:"order",orderNumber:"1045",change:{},orderStatus:"completed"});
  assert.equal(orderChangeFrom("الطلب #١٠٤١ تم شحنه، حدثه في المتجر")!.orderNumber,"1041");
  assert.equal(orderChangeFrom("mark order 1042 on hold in my store")!.orderStatus,"on-hold");
  assert.throws(()=>orderChangeFrom("الغ الطلب 1045 في المتجر"),/does not cancel or refund/);
  assert.equal(orderChangeFrom("خفض سعر العسل في متجري إلى 40"),null);
  console.log("woocommerce: order changes are read from the owner's words, and cancel/refund refused");
}
{
  // The value is read by code (seen live: the model filled "sale_price":"45" for "lower the price to 40").
  const {productChangeFrom}=await import("../src/business/woocommerce.js");
  const {sampleCatalog}=await import("./fixtures/fake-woocommerce.js");
  const [honey,,oil]=sampleCatalog().products;
  assert.deepEqual(productChangeFrom("خفّض سعر عسل السدر 500 جرام في متجري إلى 40 ريال",honey),{regular_price:"40"},"500 is part of the name");
  assert.deepEqual(productChangeFrom("حط عرض على العسل بـ 39",honey),{sale_price:"39"});
  assert.throws(()=>productChangeFrom("حط عرض على العسل بـ 50",honey),/not below the normal price 45/);
  assert.deepEqual(productChangeFrom("حدث مخزون الزيت في المتجر إلى ٩",oil),{stock_quantity:9});
  assert.throws(()=>productChangeFrom("خفّض سعر الزيت في متجري شوية",oil),/exact new price/);
  console.log("woocommerce: the field and number come from the owner's words");
}
{
  // The owner reads why nothing changed, in Arabic, as the reply.
  const {storeMessage}=await import("../src/business/woocommerce.js");
  const {composeTaskAnswer}=await import("../src/core/task-answer.js");
  assert.equal(storeMessage("Say the exact new price.",true),"اكتب السعر الجديد بالضبط، مثل: «إلى 40».");
  assert.match(storeMessage("LayanX does not cancel or refund orders: x",true),/لا يلغي LayanX/);
  assert.equal(storeMessage("Say the exact new price.",false),"Say the exact new price.");
  const reply=await composeTaskAnswer({execute:async()=>{throw new Error("no model");}} as any,"خفّض سعر الزيت شوية",[{ok:false,tool:"store.change",error:"اكتب السعر الجديد بالضبط، مثل: «إلى 40».",} as any],false);
  assert.equal(reply!.text,"لم أعدّل المتجر. اكتب السعر الجديد بالضبط، مثل: «إلى 40».");
  assert.match(storeChangeReply({kind:"order",order:"1045",before:"processing",after:"completed",verified:true},true)!,/«قيد التجهيز».*«مكتمل»/);
  console.log("woocommerce: failures and order statuses reach the owner in Arabic");
}
