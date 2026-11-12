import fs from "node:fs";
import path from "node:path";
import type {ShippingDesk,Shipment} from "./shipping.js";
import {qrSvg} from "../platform/qr.js";
import type {WooClient,WooOrder,WooProduct} from "./woocommerce.js";

/**
 * From the store's orders to the shipping desk and back, and the customer's invoice.
 *  - Orders waiting to ship ("processing") become draft shipments with the cheapest carrier for the city. The weight comes
 *    from the products, cash on delivery from the order's payment method, the customer from its shipping (or billing)
 *    address. An order with something missing (no phone, no weight, no carrier for the city) is listed with the reason,
 *    never shipped with a guess. Running it again never makes a second shipment.
 *  - Delivered shipments close their order in the store (an approved store change, read back).
 *  - The invoice is the order's own lines and totals as the store charged them, with a number given once, in sequence.
 */
/** "90.00" -> 9000 minor units (halala / cent), so sums never drift. */
export function minor(value:unknown):number{
  const n=Number(String(value??"0").replace(/,/g,""));
  if(!Number.isFinite(n)||n<0)throw new Error("not an amount: "+String(value));
  return Math.round(n*100);
}
export const major=(m:number)=>(m/100).toFixed(2);
const customerOf=(o:WooOrder)=>{
  const s=o.shipping??{},b=o.billing??{};
  const pick=(k:"first_name"|"last_name"|"address_1"|"address_2"|"city"|"phone")=>(s[k]??"").trim()||(b[k]??"").trim();
  return{name:[pick("first_name"),pick("last_name")].filter(Boolean).join(" "),phone:pick("phone"),city:pick("city"),address:[pick("address_1"),pick("address_2")].filter(Boolean).join("، ")};
};
export function orderWeight(order:WooOrder,products:Map<number,WooProduct>):{kg:number}|{missing:string[]}{
  let kg=0;const missing:string[]=[];
  for(const li of order.line_items??[]){
    const w=Number(products.get(li.product_id)?.weight??"");
    if(!(w>0))missing.push(li.name);else kg+=w*Number(li.quantity||0);
  }
  return missing.length?{missing}:{kg:Math.round(kg*1000)/1000};
}
export interface StoreShipmentReport{created:Array<{order:string;shipmentId:string;carrier:string;cost:number;cod:number;city:string;weightKg:number}>;existing:Array<{order:string;shipmentId:string;status:string}>;skipped:Array<{order:string;reason:string}>;currency?:string}

export async function shipmentsFromStore(client:WooClient,desk:ShippingDesk,since=new Date(Date.now()-30*86400_000)):Promise<StoreShipmentReport>{
  const [orders,products]=await Promise.all([client.ordersSince(since),client.products()]);
  const byId=new Map(products.map(p=>[p.id,p]));
  const report:StoreShipmentReport={created:[],existing:[],skipped:[]};
  for(const order of orders.filter(o=>o.status==="processing")){
    const number=String(order.number??order.id);report.currency??=order.currency;
    const known=desk.list().find(s=>s.orderId===number&&s.status!=="cancelled");
    if(known){report.existing.push({order:number,shipmentId:known.id,status:known.status});continue;}
    const customer=customerOf(order);
    const lacking=[!customer.phone&&"phone",!customer.address&&"address",!customer.city&&"city"].filter(Boolean);
    if(lacking.length){report.skipped.push({order:number,reason:"missing customer "+lacking.join(", ")});continue;}
    const weight=orderWeight(order,byId);
    if("missing" in weight){report.skipped.push({order:number,reason:"no weight in the store for: "+weight.missing.join(", ")});continue;}
    const cod=order.payment_method==="cod"?minor(order.total):0;
    if(!desk.quote({city:customer.city,weightKg:weight.kg,cod:cod>0}).length){report.skipped.push({order:number,reason:"no carrier serves "+customer.city});continue;}
    const shipment=desk.create({orderId:number,customer,weightKg:weight.kg,charged:minor(order.shipping_total??"0"),codAmount:cod});
    const carrier=desk.carriers().find(c=>c.id===shipment.carrierId)?.name??shipment.carrierId;
    report.created.push({order:number,shipmentId:shipment.id,carrier,cost:shipment.cost,cod,city:customer.city,weightKg:weight.kg});
  }
  return report;
}

/** Delivered shipments whose store order still says "processing" are set to completed there, then read back. */
export async function closeDeliveredOrders(client:WooClient,desk:ShippingDesk,since=new Date(Date.now()-90*86400_000)){
  const delivered=desk.list({status:"delivered"});
  if(!delivered.length)return{closed:[],already:[],notInStore:[]};
  const orders=await client.ordersSince(since);
  const closed:Array<{order:string;before:string;after:string}>=[],already:string[]=[],notInStore:string[]=[];
  for(const s of delivered){
    const order=orders.find(o=>String(o.number??o.id)===s.orderId);
    if(!order){notInStore.push(s.orderId);continue;}
    if(order.status!=="processing"&&order.status!=="on-hold"){already.push(s.orderId);continue;}
    const after=await client.setOrderStatus(order.id,"completed");
    if(after.status!=="completed")throw new Error(`The store did not keep order ${s.orderId} as completed (it shows ${after.status}).`);
    closed.push({order:s.orderId,before:order.status,after:after.status});
  }
  return{closed,already,notInStore};
}

export interface Seller{name:string;vatNumber?:string;address?:string;phone?:string}
export function sellerFrom(env:NodeJS.ProcessEnv=process.env):Seller{
  return{name:env.LAYANX_SELLER_NAME?.trim()||"",...(env.LAYANX_SELLER_VAT?.trim()?{vatNumber:env.LAYANX_SELLER_VAT.trim()}:{}),...(env.LAYANX_SELLER_ADDRESS?.trim()?{address:env.LAYANX_SELLER_ADDRESS.trim()}:{}),...(env.LAYANX_SELLER_PHONE?.trim()?{phone:env.LAYANX_SELLER_PHONE.trim()}:{})};
}
export interface InvoiceLine{name:string;quantity:number;unit:number;total:number;tax:number}
export interface InvoiceDoc{number:string;date:string;orderNumber:string;currency:string;seller:Seller;customer:{name:string;city:string;address:string;phone:string};
  lines:InvoiceLine[];subtotal:number;discount:number;shipping:number;tax:number;total:number;payment:string;cod:number;trackingNumber?:string;carrier?:string;fromStore:boolean;issuedAt:string;qr?:string}

/**
 * The simplified tax invoice QR of Saudi e-invoicing (phase 1): seller name, VAT number, time, total with VAT and the VAT,
 * each as tag, length, UTF-8 bytes, then base64. Only when the owner set a VAT number.
 */
export function zatcaQr(seller:string,vat:string,issuedAt:string,total:number,tax:number):string{
  const parts=[seller,vat,issuedAt,major(total),major(tax)].map((value,i)=>{const bytes=Buffer.from(value,"utf8");if(bytes.length>255)throw new Error("invoice QR field too long");return Buffer.concat([Buffer.from([i+1,bytes.length]),bytes]);});
  return Buffer.concat(parts).toString("base64");
}

/** The invoice from the store order (its lines and totals as charged), or the shipment alone when there is no store order. */
export function buildInvoice(desk:ShippingDesk,shipment:Shipment,order:WooOrder|undefined,seller:Seller):InvoiceDoc{
  const number=desk.invoiceNumber(shipment.id);
  const carrier=desk.carriers().find(c=>c.id===shipment.carrierId)?.name;
  const issuedAt=shipment.createdAt.replace(/\.\d{3}Z$/,"Z");
  const base={number,issuedAt,date:shipment.createdAt.slice(0,10),orderNumber:shipment.orderId,seller,customer:shipment.customer,cod:shipment.codAmount,...(shipment.trackingNumber?{trackingNumber:shipment.trackingNumber}:{}),...(carrier?{carrier}:{})};
  if(!order){
    const inv=desk.invoice(shipment.id);
    return withQr({...base,currency:"",lines:[{name:"Shipping / الشحن",quantity:1,unit:inv.shipping,total:inv.shipping,tax:inv.vat}],subtotal:inv.shipping,discount:0,shipping:0,tax:inv.vat,total:inv.total,payment:shipment.codAmount?"COD":"",fromStore:false});
  }
  const lines=(order.line_items??[]).map(li=>{const total=minor(li.total),q=Number(li.quantity||0);return{name:li.name,quantity:q,unit:q?Math.round(total/q):total,total,tax:minor(li.total_tax??"0")};});
  const subtotal=lines.reduce((n,l)=>n+l.total,0);
  const doc:InvoiceDoc={...base,currency:order.currency,lines,subtotal,discount:minor(order.discount_total??"0"),shipping:minor(order.shipping_total??"0"),tax:minor(order.total_tax??"0"),total:minor(order.total),payment:order.payment_method_title||order.payment_method||"",fromStore:true};
  // The store's own total is what the customer paid; if the parts do not add up to it, say so rather than print a wrong invoice.
  // WooCommerce line totals are after the discount, and total_tax already covers the lines and the shipping.
  const sum=doc.subtotal+doc.shipping+doc.tax;
  if(Math.abs(sum-doc.total)>1)throw new Error(`Order ${shipment.orderId}: its lines, shipping and tax add up to ${major(sum)}, but the store's total is ${major(doc.total)}. Check the order in WooCommerce before invoicing.`);
  return withQr(doc);
}

const withQr=(d:InvoiceDoc):InvoiceDoc=>d.seller.vatNumber&&d.seller.name?{...d,qr:zatcaQr(d.seller.name,d.seller.vatNumber,d.issuedAt,d.total,d.tax)}:d;
const esc=(t:unknown)=>String(t??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
export function invoiceHtml(d:InvoiceDoc):string{
  const m=(v:number)=>`<bdi dir="ltr">${esc(major(v)+(d.currency?" "+d.currency:""))}</bdi>`;
  const row=(label:string,value:string,strong=false)=>`<tr${strong?' class="total"':""}><td>${label}</td><td>${value}</td></tr>`;
  return`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(d.number)}</title><style>
body{font-family:Tahoma,Arial,sans-serif;color:#111;margin:32px;font-size:14px}h1{font-size:22px;margin:0}.head{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #111;padding-bottom:12px}
.muted{color:#555}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:right}th{background:#f3f3f3}
.sum{width:50%;margin-inline-start:auto}.total td{font-weight:bold;border-top:2px solid #111}.two{display:flex;gap:24px;margin-top:16px}.two>div{flex:1}@media print{body{margin:12mm}}
</style></head><body>
<div class="head"><div><h1>${d.seller.vatNumber?"فاتورة ضريبية مبسطة":"فاتورة"}</h1><div>${esc(d.number)}</div><div class="muted">التاريخ: ${esc(d.date)} · الطلب: <bdi dir="ltr">#${esc(d.orderNumber)}</bdi></div></div>
<div><strong>${esc(d.seller.name||"—")}</strong>${d.seller.vatNumber?`<div>الرقم الضريبي: ${esc(d.seller.vatNumber)}</div>`:""}${d.seller.address?`<div class="muted">${esc(d.seller.address)}</div>`:""}${d.seller.phone?`<div class="muted">${esc(d.seller.phone)}</div>`:""}</div></div>
<div class="two"><div><strong>العميل</strong><div>${esc(d.customer.name)}</div><div class="muted">${esc(d.customer.city)} — ${esc(d.customer.address)}</div><div class="muted">${esc(d.customer.phone)}</div></div>
<div><strong>الشحن</strong><div>${esc(d.carrier??"—")}</div>${d.trackingNumber?`<div class="muted">رقم التتبع: ${esc(d.trackingNumber)}</div>`:""}<div class="muted">الدفع: ${esc(d.payment||"—")}${d.cod?` · يُحصَّل عند الاستلام ${m(d.cod)}`:""}</div></div></div>
<table><thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>
${d.lines.map(l=>`<tr><td>${esc(l.name)}</td><td>${l.quantity}</td><td>${m(l.unit)}</td><td>${m(l.total)}</td></tr>`).join("\n")}
</tbody></table>
${d.qr?`<div style="margin-top:16px;width:150px">${qrSvg(d.qr,3)}</div>`:""}
<table class="sum">${row("المجموع",m(d.subtotal))}${d.discount?row("الخصم (محسوم من الأسعار أعلاه)",m(d.discount)):""}${d.shipping?row("الشحن",m(d.shipping)):""}${row("الضريبة",m(d.tax))}${row("الإجمالي",m(d.total),true)}</table>
</body></html>`;
}

/** Writes the invoice as HTML, and as PDF when LayanX's own headless browser is available. */
export async function saveInvoice(doc:InvoiceDoc,dir:string,openBrowser?:()=>Promise<any>):Promise<{html:string;pdf?:string}>{
  fs.mkdirSync(dir,{recursive:true});
  const html=path.join(dir,doc.number+".html");
  const source=invoiceHtml(doc);
  fs.writeFileSync(html,source,"utf8");
  if(!openBrowser)return{html};
  try{
    const browser=await openBrowser();const context=await browser.newContext();
    try{const page=await context.newPage();await page.setContent(source,{waitUntil:"load"});const pdf=path.join(dir,doc.number+".pdf");await page.pdf({path:pdf,format:"A4",printBackground:true});return{html,pdf};}
    finally{await context.close().catch(()=>undefined);}
  }catch{return{html};}
}

// ------------------------------------------------------------------------------------------------ the owner's words
const norm=(t:string)=>t.toLowerCase().replace(/[ً-ْ]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه");
export type ShippingIntent={kind:"prepare"}|{kind:"invoice";order:string}|{kind:"close"}|{kind:"report"};
export function shippingIntent(goal:string):ShippingIntent|null{
  const g=norm(goal.replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))));
  const order=/(?:الطلبيه|طلبيه|الطلب|طلب|order)\s*(?:رقم|no\.?|#)?\s*#?\s*(\d{2,})/iu.exec(g)?.[1];
  if(/(?:فاتوره|فواتير|invoice)/iu.test(g)&&order)return{kind:"invoice",order};
  if(/(?:شحن|شحنات|شحنه|ship|shipment)/iu.test(g)&&/(?:جهز|جهزي|حضر|انشئ|اعمل|سوي|(?:^|\s)سو(?=\s)|اصنع|prepare|create|make)/iu.test(g)&&/(?:طلب|طلبات|order)/iu.test(g))return{kind:"prepare"};
  if(/(?:وصلت|سلمت|المسلمه|delivered)/iu.test(g)&&/(?:المتجر|متجر|store|اغلق|اقفل|حدث|مكتمل|complete)/iu.test(g))return{kind:"close"};
  // "How many shipments are late" / "shipping report" are about the owner's shipments; "how much is shipping to Aden" is a
  // general question and stays a conversation (seen in the router's tuned set).
  if(/(?:شحنات|شحنه|shipments?)/iu.test(g)&&/(?:تقرير|كم|متاخر|وضع|حاله|report|late|status|how many)/iu.test(g)||/(?:الشحن|shipping)/iu.test(g)&&/(?:تقرير|report)/iu.test(g))return{kind:"report"};
  return null;
}
