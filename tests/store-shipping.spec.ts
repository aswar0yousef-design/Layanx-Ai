import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {ShippingDesk} from "../src/business/shipping.js";
import {WooClient} from "../src/business/woocommerce.js";
import {buildInvoice,closeDeliveredOrders,minor,saveInvoice,shipmentsFromStore,shippingIntent,invoiceHtml} from "../src/business/store-shipping.js";
import {shippingReply} from "../src/core/task-answer.js";
import {startFakeWoo} from "./fixtures/fake-woocommerce.js";

assert.equal(minor("90.00"),9000);assert.equal(minor("0.1"),10);assert.equal(minor("1,250.50"),125050);
assert.deepEqual(shippingIntent("جهّز شحنات طلبات المتجر"),{kind:"prepare"});
assert.deepEqual(shippingIntent("اطبع فاتورة الطلب رقم ١٠٤١"),{kind:"invoice",order:"1041"});
assert.deepEqual(shippingIntent("الطلبات اللي وصلت اقفلها في المتجر"),{kind:"close"});
assert.deepEqual(shippingIntent("كم شحنة متأخرة؟"),{kind:"report"});
assert.equal(shippingIntent("كم طلب اليوم في متجري"),null,"a store question is not a shipping one");

const root=fs.mkdtempSync(path.join(os.tmpdir(),"store-ship-"));
const desk=new ShippingDesk(path.join(root,"shipping.json"));
desk.saveCarrier({id:"smsa",name:"سمسا",active:true,zones:{riyadh:["الرياض"]},rates:[{zone:"riyadh",firstKg:1,firstPrice:2000,extraKgPrice:500,days:2,codFee:700}]});
const now=new Date();
const store=await startFakeWoo({now});
try{
  const client=new WooClient({url:store.url,key:"ck_test",secret:"cs_test",allowWrites:true});
  // Orders waiting to ship become shipments; what cannot be shipped is listed with the reason.
  const first=await shipmentsFromStore(client,desk);
  assert.equal(first.created.length,1);
  const made=first.created[0]!;
  assert.deepEqual([made.order,made.city,made.weightKg,made.cod],["1041","الرياض",1.2,9000],"weight 2 × 0.6 kg; cash on delivery = the order total");
  assert.equal(made.cost,2000+500+700,"first kg + one extra kg + COD fee");
  const s=desk.get(made.shipmentId);
  assert.equal(s.customer.phone,"0501112233","phone from billing when the shipping address has none");
  assert.equal(s.customer.address,"حي النرجس، شارع 12");
  assert.deepEqual(first.skipped,[{order:"1045",reason:"no carrier serves الدمام"}]);
  // Running it again never makes a second shipment.
  const again=await shipmentsFromStore(client,desk);
  assert.equal(again.created.length,0);assert.deepEqual(again.existing.map(e=>e.order),["1041"]);
  assert.equal(desk.list().length,1);
  // A product without a weight is never guessed.
  store.products.find(p=>p.id===13)!.weight="";
  desk.saveCarrier({id:"aramex",name:"أرامكس",active:true,zones:{east:["الدمام"]},rates:[{zone:"east",firstKg:2,firstPrice:2500,extraKgPrice:400,days:3}]});
  assert.deepEqual((await shipmentsFromStore(client,desk)).skipped,[{order:"1045",reason:"no weight in the store for: زيت سمسم بلدي"}]);
  store.products.find(p=>p.id===13)!.weight="1.1";
  const third=await shipmentsFromStore(client,desk);
  assert.deepEqual(third.created.map(c=>[c.order,c.carrier,c.weightKg,c.cod]),[["1045","أرامكس",1.7,0]],"paid by transfer: nothing to collect");

  // The invoice is the order's own lines and totals; its number is given once, in sequence.
  const order=(await client.ordersSince(new Date(Date.now()-86400_000*2))).find(o=>o.number==="1041")!;
  const doc=buildInvoice(desk,s,order,{name:"متجر اللواء الأخضر",vatNumber:"300000000000003"});
  assert.equal(doc.number,"INV-000001");assert.equal(buildInvoice(desk,s,order,{name:"x"}).number,"INV-000001");
  assert.deepEqual(doc.lines,[{name:"عسل سدر يمني 500 جرام",quantity:2,unit:4500,total:9000,tax:0}]);
  assert.equal(doc.total,9000);assert.equal(doc.cod,9000);
  const html=invoiceHtml(doc);
  assert.match(html,/فاتورة ضريبية مبسطة/);assert.match(html,/300000000000003/);assert.match(html,/90\.00 SAR/);
  assert.ok(!invoiceHtml({...doc,customer:{...doc.customer,name:"<script>x</script>"}}).includes("<script>x"),"store text is escaped");
  // Totals that do not add up are refused, not printed.
  assert.throws(()=>buildInvoice(desk,s,{...order,total:"95.00"},{name:"x"}),/add up to 90.00, but the store's total is 95.00/);
  // VAT and shipping as WooCommerce reports them (line totals after discount; total_tax covers all).
  const vat=buildInvoice(desk,s,{...order,line_items:[{product_id:11,name:"عسل",quantity:2,total:"80.00",total_tax:"12.00"}],discount_total:"10.00",shipping_total:"20.00",total_tax:"15.00",total:"115.00"},{name:"x"});
  assert.deepEqual([vat.subtotal,vat.shipping,vat.tax,vat.total],[8000,2000,1500,11500]);
  let pw:any;try{pw=await import("playwright-core");}catch{pw=null;}
  const files=await saveInvoice(doc,path.join(root,"invoices"),pw?(await import("../src/autonomy/browser-test.js")).sharedBrowser:undefined);
  assert.ok(fs.readFileSync(files.html,"utf8").includes("INV-000001"));
  if(pw&&files.pdf)assert.equal(fs.readFileSync(files.pdf).subarray(0,4).toString(),"%PDF","a real PDF file");
  else console.log("store-shipping: no headless browser here, PDF part skipped");

  // Delivered shipments close their store order (read back); a second run changes nothing.
  await desk.book(s.id,"SMSA123");
  for(const st of ["picked_up","in_transit","delivered"] as const)desk.update(s.id,st);
  const closed=await closeDeliveredOrders(client,desk);
  assert.deepEqual(closed.closed,[{order:"1041",before:"processing",after:"completed"}]);
  assert.equal(store.orders.find(o=>o.number==="1041")!.status,"completed");
  assert.deepEqual((await closeDeliveredOrders(client,desk)).already,["1041"]);
  assert.equal(store.orders.find(o=>o.number==="1045")!.status,"processing","an undelivered order is not touched");

  // Replies are written by code.
  const reply=shippingReply("shipping.from_store",{...first,currency:"SAR"},true)!;
  assert.match(reply,/جهّزتُ 1 شحنة/);assert.match(reply,/#1041: سمسا — الرياض — 1.2 كغ — التكلفة 32.00 SAR — يُحصَّل عند الاستلام 90.00 SAR/);
  assert.match(reply,/#1045: لا شركة شحن تخدم الدمام/);
  assert.match(shippingReply("shipping.report",desk.report(),true)!,/سمسا: 1 شحنة، سُلِّم 1/);
}finally{await store.close();}
{
  const {routeRequest}=await import("../src/voice/request-router.js");
  for(const t of ["جهّز شحنات طلبات المتجر","اطبع فاتورة الطلب 1041","كم شحنة متأخرة؟"])assert.equal(routeRequest(t).route,"task",t);
  const {AiMissionPlanner}=await import("../src/core/ai-planner.js");
  const planner=new AiMissionPlanner({execute:async()=>{throw new Error("no model");}} as any);
  const catalog=["shipping.from_store","shipping.invoice.document","shipping.store.close","shipping.report","store.report"].map(name=>({name,description:"",permission:"L3_MODIFY",dangerous:false,actions:[name],tags:[]})) as any;
  assert.equal((await planner.plan("جهّز شحنات طلبات المتجر",catalog)).tools[0]!.tool,"shipping.from_store","not the store report");
  assert.deepEqual((await planner.plan("اطبع فاتورة الطلب 1041",catalog)).tools[0]!.payload,{goal:"اطبع فاتورة الطلب 1041",order:"1041"});
}
console.log("store-shipping: store orders become shipments without guesses, invoices match the store's totals, delivered orders are closed and read back");

{
  // Wordings seen in testing: "سوّ" (with shadda) and "الطلبية".
  assert.deepEqual(shippingIntent("سوّ شحنات للطلبات الجديدة"),{kind:"prepare"});
  assert.deepEqual(shippingIntent("طلعلي فاتورة الطلبية 1041"),{kind:"invoice",order:"1041"});
  assert.equal(shippingIntent("ما هي شركة سمسا؟"),null);assert.equal(shippingIntent("كيف أشحن لليمن؟"),null);
}
{
  // The e-invoicing QR matches the published reference example byte for byte.
  const {zatcaQr,invoiceHtml}=await import("../src/business/store-shipping.js");
  assert.equal(zatcaQr("Bobs Records","310122393500003","2022-04-25T15:30:00Z",100000,15000),"AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==");
  const tlv=Buffer.from(zatcaQr("متجر اللواء","300000000000003","2026-11-12T10:00:00Z",9000,0),"base64");
  assert.equal(tlv[0],1);assert.equal(tlv.subarray(2,2+tlv[1]!).toString("utf8"),"متجر اللواء","Arabic seller name as UTF-8 bytes, length in bytes");
  const doc:any={number:"INV-1",issuedAt:"2026-11-12T10:00:00Z",date:"2026-11-12",orderNumber:"1",currency:"SAR",seller:{name:"x",vatNumber:"3"},customer:{name:"",city:"",address:"",phone:""},lines:[],subtotal:0,discount:0,shipping:0,tax:0,total:0,payment:"",cod:0,fromStore:true,qr:"AQ=="};
  assert.match(invoiceHtml(doc),/<svg/);assert.ok(!/<svg/.test(invoiceHtml({...doc,qr:undefined})));
}
process.exit(0);
