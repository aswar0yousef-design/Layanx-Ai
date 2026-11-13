import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";

/**
 * The shipping desk: carriers and their prices, the best quote for a parcel, each shipment from booking to delivery,
 * invoices, reconciliation of a carrier's bill, and reports. Money is whole minor units (halala, cent), so totals never drift.
 * A carrier's own API plugs in through CarrierAdapter when the owner has an account; until then tracking is entered by hand.
 */
export interface CarrierRate{zone:string;firstKg:number;firstPrice:number;extraKgPrice:number;days:number;codFee?:number}
export interface Carrier{id:string;name:string;active:boolean;zones:Record<string,string[]>;rates:CarrierRate[]}
export type ShipmentStatus="draft"|"booked"|"picked_up"|"in_transit"|"out_for_delivery"|"delivered"|"delivery_failed"|"returned"|"cancelled";
export interface TrackingEvent{at:string;status:ShipmentStatus;note?:string;source:"manual"|"carrier"}
export interface Customer{name:string;phone:string;city:string;address:string}
export interface Shipment{id:string;orderId:string;carrierId:string;customer:Customer;weightKg:number;cost:number;charged:number;codAmount:number;codCollected:boolean;promisedDays:number;status:ShipmentStatus;trackingNumber?:string;createdAt:string;events:TrackingEvent[];invoiceNumber?:string;source?:"store"|"manual"}
export interface Quote{carrierId:string;carrierName:string;zone:string;price:number;days:number}
export interface CarrierAdapter{book(shipment:Shipment):Promise<{trackingNumber:string}>;track(trackingNumber:string):Promise<Array<{at:string;status:ShipmentStatus;note?:string}>>}
export interface ShippingState{carriers:Carrier[];shipments:Shipment[];vatPercent:number;invoiceSeq?:number}

const NEXT:Record<ShipmentStatus,ShipmentStatus[]>={
  draft:["booked","cancelled"],booked:["picked_up","cancelled"],picked_up:["in_transit","delivery_failed"],
  in_transit:["out_for_delivery","delivered","delivery_failed"],out_for_delivery:["delivered","delivery_failed"],
  delivery_failed:["out_for_delivery","returned"],delivered:[],returned:[],cancelled:[]
};
const money=(value:number,label:string)=>{if(!Number.isInteger(value)||value<0)throw new Error(`shipping_invalid_amount:${label}`);return value;};
const normalCity=(city:string)=>city.trim().toLowerCase().replace(/[أإآ]/g,"ا").replace(/ة/g,"ه").replace(/^ال/,"");
const dayMs=86_400_000;

export class ShippingDesk{
  private cached:ShippingState;
  private stamp="";
  constructor(private readonly file:string,private readonly adapters:Record<string,CarrierAdapter>={},private readonly now:()=>Date=()=>new Date()){
    this.cached=this.read();
  }
  /**
   * The agent's tools and the panel each hold a desk on the same file. Each used to keep its first reading forever, so a
   * save from one erased what the other had just added; the file is read again whenever someone else has written it.
   */
  private get state():ShippingState{
    const stamp=this.mtime();
    if(stamp!==this.stamp)this.cached=this.read();
    return this.cached;
  }
  // Two saves in the same millisecond have the same time (seen once in the release check, 2026-11-13): every save renames a
  // new file into place, so the file's number changes each time and tells the versions apart.
  private mtime(){try{const s=fs.statSync(this.file,{bigint:true});return`${s.mtimeNs}:${s.size}:${s.ino}`;}catch{return"-";}}
  private read():ShippingState{this.stamp=this.mtime();try{return{carriers:[],shipments:[],vatPercent:15,invoiceSeq:0,...JSON.parse(fs.readFileSync(this.file,"utf8"))};}catch{return{carriers:[],shipments:[],vatPercent:15,invoiceSeq:0};}}
  private save(){
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    const temporary=this.file+"."+randomUUID()+".tmp";
    fs.writeFileSync(temporary,JSON.stringify(this.cached,null,2),{mode:0o600});
    fs.renameSync(temporary,this.file);
    this.stamp=this.mtime();
  }
  setVat(percent:number){if(!(percent>=0&&percent<=100))throw new Error("shipping_invalid_vat");this.state.vatPercent=percent;this.save();}
  saveCarrier(carrier:Carrier){
    if(!carrier.id.trim()||!carrier.name.trim())throw new Error("shipping_carrier_name_required");
    for(const rate of carrier.rates){
      if(!carrier.zones[rate.zone])throw new Error("shipping_unknown_zone:"+rate.zone);
      if(!(rate.firstKg>0)||!(rate.days>0))throw new Error("shipping_invalid_rate:"+rate.zone);
      money(rate.firstPrice,"firstPrice");money(rate.extraKgPrice,"extraKgPrice");if(rate.codFee!==undefined)money(rate.codFee,"codFee");
    }
    this.state.carriers=[...this.state.carriers.filter(item=>item.id!==carrier.id),carrier];this.save();return carrier;
  }
  carriers(){return this.state.carriers;}
  /** Every active carrier that serves the city, cheapest first, then fastest. Weight is charged in whole kilograms above the first band. */
  quote(input:{city:string;weightKg:number;cod?:boolean}):Quote[]{
    if(!(input.weightKg>0))throw new Error("shipping_invalid_weight");
    const city=normalCity(input.city),quotes:Quote[]=[];
    for(const carrier of this.state.carriers.filter(item=>item.active)){
      const zone=Object.entries(carrier.zones).find(([,cities])=>cities.some(name=>normalCity(name)===city))?.[0];
      const rate=zone?carrier.rates.find(item=>item.zone===zone):undefined;
      if(!rate)continue;
      const extra=Math.max(0,Math.ceil(input.weightKg-rate.firstKg));
      quotes.push({carrierId:carrier.id,carrierName:carrier.name,zone:zone!,price:rate.firstPrice+extra*rate.extraKgPrice+(input.cod?rate.codFee??0:0),days:rate.days});
    }
    return quotes.sort((a,b)=>a.price-b.price||a.days-b.days);
  }
  /** One order has one shipment: asking twice returns the first, so a retry cannot ship twice. */
  create(input:{orderId:string;customer:Customer;weightKg:number;charged:number;codAmount?:number;carrierId?:string}):Shipment{
    const existing=this.state.shipments.find(item=>item.orderId===input.orderId&&item.status!=="cancelled");
    if(existing)return existing;
    money(input.charged,"charged");money(input.codAmount??0,"codAmount");
    if(!input.customer.phone.trim()||!input.customer.address.trim())throw new Error("shipping_customer_contact_required");
    const quotes=this.quote({city:input.customer.city,weightKg:input.weightKg,cod:(input.codAmount??0)>0});
    const chosen=input.carrierId?quotes.find(item=>item.carrierId===input.carrierId):quotes[0];
    if(!chosen)throw new Error("shipping_no_carrier_for_city");
    const shipment:Shipment={id:randomUUID(),orderId:input.orderId,carrierId:chosen.carrierId,customer:input.customer,weightKg:input.weightKg,cost:chosen.price,charged:input.charged,codAmount:input.codAmount??0,codCollected:false,promisedDays:chosen.days,status:"draft",createdAt:this.now().toISOString(),events:[]};
    this.state.shipments.push(shipment);this.save();
    return shipment;
  }
  get(id:string){const found=this.state.shipments.find(item=>item.id===id);if(!found)throw new Error("shipping_not_found");return found;}
  list(filter:{status?:ShipmentStatus;carrierId?:string}={}){return this.state.shipments.filter(item=>(!filter.status||item.status===filter.status)&&(!filter.carrierId||item.carrierId===filter.carrierId));}
  private move(shipment:Shipment,status:ShipmentStatus,source:TrackingEvent["source"],at:string,note?:string){
    if(!NEXT[shipment.status].includes(status))throw new Error(`shipping_invalid_transition:${shipment.status}->${status}`);
    shipment.status=status;shipment.events.push({at,status,source,...(note?{note}:{})});
  }
  /** Sending to a real carrier is an outward action: it is called only after the owner's approval, through the tool layer. */
  async book(id:string,manualTracking?:string):Promise<Shipment>{
    const shipment=this.get(id);
    if(shipment.status==="booked")return shipment;
    const adapter=this.adapters[shipment.carrierId];
    if(!adapter&&!manualTracking?.trim())throw new Error("shipping_tracking_number_required");
    if(shipment.status!=="draft")throw new Error(`shipping_invalid_transition:${shipment.status}->booked`);
    shipment.trackingNumber=adapter?(await adapter.book(shipment)).trackingNumber:manualTracking!.trim();
    this.move(shipment,"booked",adapter?"carrier":"manual",this.now().toISOString());
    this.save();return shipment;
  }
  update(id:string,status:ShipmentStatus,note?:string){const shipment=this.get(id);this.move(shipment,status,"manual",this.now().toISOString(),note);this.save();return shipment;}
  /** Applies whatever the carrier newly reports, in order. A repeated or impossible report changes nothing and is listed. */
  async refresh(id:string){
    const shipment=this.get(id),adapter=this.adapters[shipment.carrierId];
    if(!adapter||!shipment.trackingNumber)throw new Error("shipping_carrier_tracking_unavailable");
    const events=(await adapter.track(shipment.trackingNumber)).sort((a,b)=>a.at.localeCompare(b.at));
    const applied:ShipmentStatus[]=[],ignored:string[]=[];
    for(const event of events){
      if(shipment.events.some(known=>known.at===event.at&&known.status===event.status))continue;
      const latest=shipment.events.at(-1)?.at;
      if(latest&&event.at<latest){ignored.push(`${event.status} at ${event.at}`);continue;}
      if(NEXT[shipment.status].includes(event.status)){this.move(shipment,event.status,"carrier",event.at,event.note);applied.push(event.status);}
      else ignored.push(`${event.status} at ${event.at}`);
    }
    this.save();
    return{shipment,applied,ignored};
  }
  recordCodCollected(id:string){const shipment=this.get(id);if(shipment.status!=="delivered"||!shipment.codAmount)throw new Error("shipping_cod_not_collectable");shipment.codCollected=true;this.save();return shipment;}
  /** A shipment's invoice number: given once, in sequence (INV-000001, ...), and never reused. */
  invoiceNumber(id:string):string{
    const shipment=this.get(id);
    if(shipment.invoiceNumber)return shipment.invoiceNumber;
    const next=(this.cached.invoiceSeq??0)+1;
    this.cached.invoiceSeq=next;shipment.invoiceNumber="INV-"+String(next).padStart(6,"0");this.save();
    return shipment.invoiceNumber;
  }
  /** The customer's invoice, with tax worked out once and rounded once. */
  invoice(id:string){
    const shipment=this.get(id),vat=Math.round(shipment.charged*this.state.vatPercent/100);
    return{number:"INV-"+shipment.orderId,date:shipment.createdAt.slice(0,10),customer:shipment.customer.name,orderId:shipment.orderId,trackingNumber:shipment.trackingNumber,shipping:shipment.charged,vatPercent:this.state.vatPercent,vat,total:shipment.charged+vat};
  }
  /** Compares a carrier's bill with what the shipments should have cost. */
  reconcile(carrierId:string,bill:Array<{trackingNumber:string;amount:number}>){
    const mine=new Map(this.list({carrierId}).filter(item=>item.trackingNumber).map(item=>[item.trackingNumber!,item]));
    const seen=new Set<string>(),mismatches:Array<{trackingNumber:string;expected:number;billed:number}>=[],unknown:string[]=[],duplicates:string[]=[];
    let matched=0;
    for(const line of bill){
      money(line.amount,"bill");
      if(seen.has(line.trackingNumber)){duplicates.push(line.trackingNumber);continue;}
      seen.add(line.trackingNumber);
      const shipment=mine.get(line.trackingNumber);
      if(!shipment){unknown.push(line.trackingNumber);continue;}
      if(shipment.cost===line.amount)matched++;else mismatches.push({trackingNumber:line.trackingNumber,expected:shipment.cost,billed:line.amount});
    }
    return{matched,mismatches,unknown,duplicates,overBilled:mismatches.reduce((sum,item)=>sum+Math.max(0,item.billed-item.expected),0)};
  }
  /** Per carrier, between two dates: volume, delivery rate, lateness, margin and cash still with the carrier. */
  report(from?:string,to?:string){
    const inRange=this.state.shipments.filter(item=>item.status!=="cancelled"&&(!from||item.createdAt>=from)&&(!to||item.createdAt<=to));
    const now=this.now().getTime(),carriers:Record<string,{name:string;shipments:number;delivered:number;failedOrReturned:number;late:number;cost:number;charged:number;margin:number;codOutstanding:number}>={};
    for(const item of inRange){
      const row=carriers[item.carrierId]??={name:this.state.carriers.find(c=>c.id===item.carrierId)?.name??item.carrierId,shipments:0,delivered:0,failedOrReturned:0,late:0,cost:0,charged:0,margin:0,codOutstanding:0};
      const due=new Date(item.createdAt).getTime()+item.promisedDays*dayMs,deliveredAt=item.events.find(event=>event.status==="delivered")?.at;
      row.shipments++;row.cost+=item.cost;row.charged+=item.charged;row.margin+=item.charged-item.cost;
      if(item.status==="delivered"){row.delivered++;if(!item.codCollected)row.codOutstanding+=item.codAmount;}
      if(item.status==="delivery_failed"||item.status==="returned")row.failedOrReturned++;
      if(deliveredAt?new Date(deliveredAt).getTime()>due:(!["returned"].includes(item.status)&&now>due))row.late++;
    }
    return{shipments:inRange.length,carriers};
  }
}
