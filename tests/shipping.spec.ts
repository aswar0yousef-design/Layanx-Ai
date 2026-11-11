import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {ShippingDesk,type Carrier,type CarrierAdapter} from "../src/business/shipping.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"ship-"));
let n=0,clock=new Date("2026-01-01T00:00:00Z");
const file=()=>path.join(root,`s${++n}.json`);
const carrierA:Carrier={id:"a",name:"Fast",active:true,zones:{main:["الرياض","جدة"],far:["تبوك"]},rates:[{zone:"main",firstKg:5,firstPrice:2500,extraKgPrice:300,days:2,codFee:1000},{zone:"far",firstKg:5,firstPrice:4000,extraKgPrice:500,days:5}]};
const carrierB:Carrier={id:"b",name:"Cheap",active:true,zones:{main:["الرياض"]},rates:[{zone:"main",firstKg:1,firstPrice:2000,extraKgPrice:400,days:4}]};
const desk=(adapters={})=>{const d=new ShippingDesk(file(),adapters,()=>clock);d.saveCarrier(carrierA);d.saveCarrier(carrierB);return d;};
const customer={name:"سارة",phone:"0500000000",city:"الرياض",address:"حي 1"};

{ // Prices.
  const d=desk();
  assert.deepEqual(d.quote({city:"الرياض",weightKg:1}).map(q=>[q.carrierId,q.price]),[["b",2000],["a",2500]]);
  assert.deepEqual(d.quote({city:"الرياض",weightKg:3}).map(q=>[q.carrierId,q.price]),[["a",2500],["b",2800]]);
  assert.equal(d.quote({city:"الرياض",weightKg:5.5}).find(q=>q.carrierId==="a")!.price,2800);
  assert.equal(d.quote({city:"الرياض",weightKg:1,cod:true}).find(q=>q.carrierId==="a")!.price,3500);
  assert.equal(d.quote({city:"رياض ",weightKg:1}).length,2);
  assert.deepEqual(d.quote({city:"دبي",weightKg:1}),[]);
  assert.throws(()=>d.quote({city:"جدة",weightKg:0}),/invalid_weight/);
  d.saveCarrier({...carrierB,active:false});
  assert.equal(d.quote({city:"الرياض",weightKg:1}).length,1);
  assert.throws(()=>d.saveCarrier({...carrierA,rates:[{zone:"none",firstKg:1,firstPrice:1,extraKgPrice:1,days:1}]}),/unknown_zone/);
  assert.throws(()=>d.saveCarrier({...carrierA,rates:[{zone:"main",firstKg:1,firstPrice:1.5,extraKgPrice:1,days:1}]}),/invalid_amount/);
}
{ // One order, one shipment; the cheapest carrier by default; the state survives a restart.
  const f=file(),d=new ShippingDesk(f,{},()=>clock);d.saveCarrier(carrierA);d.saveCarrier(carrierB);
  const s=d.create({orderId:"1",customer,weightKg:1,charged:3000});
  assert.equal(s.carrierId,"b");assert.equal(s.cost,2000);
  assert.equal(d.create({orderId:"1",customer,weightKg:9,charged:1}).id,s.id);
  assert.equal(d.list().length,1);
  assert.equal(d.create({orderId:"2",customer,weightKg:1,charged:3000,carrierId:"a"}).carrierId,"a");
  assert.throws(()=>d.create({orderId:"3",customer:{...customer,city:"دبي"},weightKg:1,charged:1}),/no_carrier/);
  assert.throws(()=>d.create({orderId:"4",customer:{...customer,phone:" "},weightKg:1,charged:1}),/contact_required/);
  assert.equal(new ShippingDesk(f).get(s.id).orderId,"1");
  d.update(s.id,"cancelled");
  assert.notEqual(d.create({orderId:"1",customer,weightKg:1,charged:3000}).id,s.id);
}
{ // The path of a parcel can only move forward; booking without a carrier needs a tracking number.
  const d=desk(),s=d.create({orderId:"1",customer,weightKg:1,charged:3000});
  await assert.rejects(d.book(s.id),/tracking_number_required/);
  assert.throws(()=>d.update(s.id,"delivered"),/invalid_transition:draft->delivered/);
  await d.book(s.id,"T1");
  assert.equal(s.status,"booked");
  assert.equal((await d.book(s.id,"T2")).trackingNumber,"T1");
  d.update(s.id,"picked_up");d.update(s.id,"in_transit");d.update(s.id,"delivery_failed","no answer");d.update(s.id,"out_for_delivery");d.update(s.id,"delivered");
  assert.throws(()=>d.update(s.id,"returned"),/invalid_transition/);
  assert.equal(s.events.length,6);
  await assert.rejects(d.refresh(s.id),/tracking_unavailable/);
}
{ // A carrier integration: booked once, reports applied in order, repeats and impossible reports do no harm.
  let booked=0;
  const adapter:CarrierAdapter={book:async()=>{booked++;return{trackingNumber:"C1"};},track:async()=>[
    {at:"2026-01-02T10:00:00Z",status:"in_transit"},{at:"2026-01-02T08:00:00Z",status:"picked_up"},{at:"2026-01-02T09:00:00Z",status:"delivered"}]};
  const d=desk({a:adapter}),s=d.create({orderId:"1",customer,weightKg:1,charged:3000,carrierId:"a"});
  await d.book(s.id);await d.book(s.id);
  assert.equal(booked,1);
  const first=await d.refresh(s.id);
  assert.deepEqual(first.applied,["picked_up","in_transit"]);
  assert.deepEqual(first.ignored,["delivered at 2026-01-02T09:00:00Z"]);
  assert.deepEqual((await d.refresh(s.id)).applied,[]);
  assert.equal(s.status,"in_transit");
}
{ // Tax, reconciliation and reports add up in whole units.
  const d=desk();d.setVat(15);
  const a=d.create({orderId:"1",customer,weightKg:1,charged:3333,codAmount:10000,carrierId:"a"});
  assert.deepEqual([d.invoice(a.id).vat,d.invoice(a.id).total],[500,3833]);
  assert.equal(a.cost,3500);
  assert.throws(()=>d.recordCodCollected(a.id),/not_collectable/);
  await d.book(a.id,"T1");d.update(a.id,"picked_up");d.update(a.id,"in_transit");
  clock=new Date("2026-01-02T00:00:00Z");d.update(a.id,"delivered");
  const late=d.create({orderId:"2",customer,weightKg:1,charged:4000,carrierId:"a"});await d.book(late.id,"T2");
  const ontime=d.create({orderId:"3",customer,weightKg:1,charged:4000,carrierId:"a"});await d.book(ontime.id,"T3");
  const r=d.reconcile("a",[{trackingNumber:"T1",amount:3500},{trackingNumber:"T2",amount:9000},{trackingNumber:"T2",amount:9000},{trackingNumber:"X",amount:1}]);
  assert.deepEqual(r,{matched:1,mismatches:[{trackingNumber:"T2",expected:2500,billed:9000}],unknown:["X"],duplicates:["T2"],overBilled:6500});
  clock=new Date("2026-01-05T00:00:00Z");
  const row=d.report().carriers.a!;
  assert.deepEqual(row,{shipments:3,delivered:1,failedOrReturned:0,late:2,cost:8500,charged:11333,margin:2833,codOutstanding:10000});
  d.recordCodCollected(a.id);
  assert.equal(d.report().carriers.a!.codOutstanding,0);
  assert.equal(d.report("2026-02-01").shipments,0);
}
fs.rmSync(root,{recursive:true,force:true});
console.log("shipping: quotes, one shipment per order, forward-only tracking, invoices, carrier-bill checks and reports add up");
