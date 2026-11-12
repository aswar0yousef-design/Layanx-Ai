import {localSecret} from "../security/local-secret-vault.js";
import {extractJson} from "../providers/adaptive-ollama.js";

/**
 * The owner's WooCommerce store, through its official REST API (wp-json/wc/v3) and the read/write keys the owner created in
 * WooCommerce -> Settings -> Advanced -> REST API and typed into the LayanX panel. LayanX never sees a WordPress password.
 *  - Reading (orders, products, stock, a sales report) needs only the keys.
 *  - Changing the store (a price, stock, an order's status) is off until the owner turns on LAYANX_WOOCOMMERCE_ALLOW_WRITES,
 *    every change waits for the owner's approval as a dangerous tool, and after each change the product or order is read back
 *    from the store: the reply says what the store now holds, not what was sent.
 *  - Money stays with the owner: refunds and cancellations are never done here.
 */
export interface WooConfig{url:string;key:string;secret:string;allowWrites:boolean}
export interface WooProduct{id:number;name:string;sku:string;status:string;price:string;regular_price:string;sale_price:string;stock_status:string;stock_quantity:number|null;manage_stock:boolean;total_sales?:number;permalink?:string;weight?:string}
export interface WooLineItem{product_id:number;name:string;quantity:number;total:string;total_tax?:string;price?:number|string;sku?:string}
export interface WooAddress{first_name?:string;last_name?:string;address_1?:string;address_2?:string;city?:string;phone?:string;email?:string}
export interface WooOrder{id:number;number:string;status:string;total:string;currency:string;date_created_gmt:string;line_items:WooLineItem[];billing?:WooAddress;shipping?:WooAddress;payment_method?:string;payment_method_title?:string;shipping_total?:string;total_tax?:string;discount_total?:string}
export type Fetcher=typeof fetch;

/** "mystore.com", "https://mystore.com/shop/" or a full ".../wp-json/wc/v3" become the REST base. */
export function wooBase(site:string):string{
  let s=site.trim();
  if(!/^https?:\/\//i.test(s))s="https://"+s;
  const u=new URL(s);
  const isLocal=/^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])$/i.test(u.hostname);
  // The keys travel with every request: only an encrypted connection, except to this computer itself (nothing leaves it).
  if(u.protocol!=="https:"&&!isLocal)throw new Error("The store address must start with https:// so the store keys are sent encrypted.");
  const path=u.pathname.replace(/\/+$/,"");
  const base=/\/wp-json\/wc\/v3$/i.test(path)?path:path.replace(/\/wp-json.*$/i,"")+"/wp-json/wc/v3";
  return u.origin+base;
}

export function wooConfig(env:NodeJS.ProcessEnv=process.env):WooConfig|null{
  const url=env.LAYANX_WOOCOMMERCE_URL?.trim();
  const key=localSecret("woocommerce.consumer_key",env.LAYANX_WOOCOMMERCE_CONSUMER_KEY);
  const secret=localSecret("woocommerce.consumer_secret",env.LAYANX_WOOCOMMERCE_CONSUMER_SECRET);
  if(!url||!key||!secret)return null;
  return{url,key,secret,allowWrites:/^(?:1|true|on|yes)$/i.test(env.LAYANX_WOOCOMMERCE_ALLOW_WRITES??"")};
}
export const WOO_SETUP_HINT="The store is not connected. In the LayanX panel (Setup -> Secrets) add LAYANX_WOOCOMMERCE_URL (the store address), LAYANX_WOOCOMMERCE_CONSUMER_KEY and LAYANX_WOOCOMMERCE_CONSUMER_SECRET (WooCommerce -> Settings -> Advanced -> REST API, Read permission is enough for reports).";

export class WooClient{
  readonly base:string;
  constructor(private readonly config:WooConfig,private readonly fetcher:Fetcher=fetch){this.base=wooBase(config.url);}
  get canWrite(){return this.config.allowWrites;}

  private async call(method:string,path:string,query:Record<string,string|number>={},body?:unknown):Promise<{data:any;headers:Headers}>{
    const u=new URL(this.base+"/"+path.replace(/^\//,""));
    for(const[k,v]of Object.entries(query))u.searchParams.set(k,String(v));
    const auth="Basic "+Buffer.from(this.config.key+":"+this.config.secret).toString("base64");
    const response=await this.fetcher(u.toString(),{method,redirect:"error",signal:AbortSignal.timeout(30_000),
      headers:{authorization:auth,accept:"application/json",...(body?{"content-type":"application/json"}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const text=await response.text();
    let data:any=null;try{data=text?JSON.parse(text):null;}catch{data=null;}
    if(!response.ok){
      const code=typeof data?.code==="string"?data.code:"";
      if(response.status===401||response.status===403)throw new Error(`The store refused the keys (${response.status}${code?" "+code:""}). Check the consumer key and secret, and that their permission is ${method==="GET"?"Read":"Read/Write"}.`);
      if(response.status===404&&/rest_no_route/.test(code))throw new Error("This address has no WooCommerce REST API (rest_no_route). Check the store address and that WooCommerce is active.");
      throw new Error(`The store answered ${response.status}${code?" "+code:""}${typeof data?.message==="string"?": "+data.message.slice(0,200):""}`);
    }
    if(data===null)throw new Error("The store did not answer with JSON; the address may not be a WooCommerce store.");
    return{data,headers:response.headers};
  }
  /** Every page of a list (WooCommerce gives at most 100 per page and the page count in X-WP-TotalPages). */
  private async all<T>(path:string,query:Record<string,string|number>={},maxPages=20):Promise<T[]>{
    const out:T[]=[];
    for(let page=1;page<=maxPages;page++){
      const {data,headers}=await this.call("GET",path,{...query,per_page:100,page});
      if(!Array.isArray(data))throw new Error("The store answered a list request with something else.");
      out.push(...data as T[]);
      const pages=Number(headers.get("x-wp-totalpages")??"1");
      if(page>=pages||data.length<100)break;
    }
    return out;
  }
  /** The keys work and how big the store is. */
  async status(){
    const {headers}=await this.call("GET","products",{per_page:1});
    const orders=await this.call("GET","orders",{per_page:1});
    return{store:new URL(this.base).host,products:Number(headers.get("x-wp-total")??0),orders:Number(orders.headers.get("x-wp-total")??0),writesAllowed:this.canWrite};
  }
  products(){return this.all<WooProduct>("products",{status:"any"});}
  ordersSince(since:Date){return this.all<WooOrder>("orders",{after:since.toISOString(),dates_are_gmt:"true",status:"any"});}
  async product(id:number){return(await this.call("GET","products/"+id)).data as WooProduct;}
  async order(id:number){return(await this.call("GET","orders/"+id)).data as WooOrder;}
  private needWrites(){if(!this.canWrite)throw new Error("Changing the store is off. The owner turns it on with LAYANX_WOOCOMMERCE_ALLOW_WRITES=on in the panel (the keys also need Read/Write permission).");}
  /** One change to one product, then the product as the store now holds it. */
  async updateProduct(id:number,change:{regular_price?:string;sale_price?:string;stock_quantity?:number;status?:string}){
    this.needWrites();
    const body:Record<string,unknown>={...change};
    if(change.stock_quantity!==undefined)body.manage_stock=true;
    await this.call("PUT","products/"+id,{},body);
    return this.product(id);
  }
  async setOrderStatus(id:number,status:string){
    this.needWrites();
    if(!SAFE_ORDER_STATUS.has(status))throw new Error(`LayanX does not set orders to "${status}": cancelling or refunding moves the customer's money, so the owner does it in WooCommerce.`);
    await this.call("PUT","orders/"+id,{},{status});
    return this.order(id);
  }
  /** Finds a product by SKU first (so a retry never makes a second one), then creates it as a draft. */
  async upsertProduct(p:{name:string;sku:string;regular_price:string;description?:string;stock_quantity?:number}){
    this.needWrites();
    const existing=(await this.call("GET","products",{sku:p.sku,status:"any"})).data as WooProduct[];
    if(Array.isArray(existing)&&existing[0]){await this.call("PUT","products/"+existing[0].id,{},{name:p.name,regular_price:p.regular_price,...(p.description?{description:p.description}:{})});return{created:false,product:await this.product(existing[0].id)};}
    const made=(await this.call("POST","products",{},{name:p.name,sku:p.sku,regular_price:p.regular_price,status:"draft",...(p.description?{description:p.description}:{}),...(p.stock_quantity!==undefined?{manage_stock:true,stock_quantity:p.stock_quantity}:{})})).data as WooProduct;
    return{created:true,product:await this.product(made.id)};
  }
}
const SAFE_ORDER_STATUS=new Set(["processing","on-hold","completed"]);

/** Orders that brought money in; pending/failed were never paid, cancelled/refunded gave it back. */
const PAID=new Set(["processing","completed","on-hold"]);
export interface StoreReport{store:string;from:string;days:number;orders:number;byStatus:Record<string,number>;revenue:Record<string,number>;
  toShip:Array<{number:string;total:string;currency:string;city?:string;items:string}>;top:Array<{name:string;quantity:number}>;
  outOfStock:string[];lowStock:Array<{name:string;left:number}>;products:number}

/** The start of "today" (or N days back) on this computer's clock, as a time the store understands. */
export function periodStart(days:number,now=new Date()):Date{const d=new Date(now);d.setHours(0,0,0,0);d.setDate(d.getDate()-(Math.max(1,days)-1));return d;}

export async function storeReport(client:WooClient,days=1,now=new Date(),lowAt=3):Promise<StoreReport>{
  const from=periodStart(days,now);
  const [orders,products]=await Promise.all([client.ordersSince(from),client.products()]);
  const byStatus:Record<string,number>={},revenue:Record<string,number>={},sold=new Map<string,number>();
  for(const o of orders){
    byStatus[o.status]=(byStatus[o.status]??0)+1;
    if(!PAID.has(o.status))continue;
    revenue[o.currency]=Math.round(((revenue[o.currency]??0)+Number(o.total||0))*100)/100;
    for(const li of o.line_items??[])sold.set(li.name,(sold.get(li.name)??0)+Number(li.quantity||0));
  }
  const live=products.filter(p=>p.status==="publish");
  return{store:new URL(client.base).host,from:from.toISOString(),days,orders:orders.length,byStatus,revenue,
    toShip:orders.filter(o=>o.status==="processing").slice(0,20).map(o=>({number:String(o.number??o.id),total:o.total,currency:o.currency,...(o.shipping?.city||o.billing?.city?{city:o.shipping?.city||o.billing?.city}:{}),items:(o.line_items??[]).map(l=>`${l.name} ×${l.quantity}`).join("، ")})),
    top:[...sold].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name,quantity])=>({name,quantity})),
    outOfStock:live.filter(p=>p.stock_status==="outofstock").map(p=>p.name).slice(0,30),
    lowStock:live.filter(p=>p.manage_stock&&p.stock_status!=="outofstock"&&p.stock_quantity!==null&&p.stock_quantity<=lowAt).map(p=>({name:p.name,left:p.stock_quantity as number})).slice(0,30),
    products:live.length};
}

// ----------------------------------------------------------------------------------------------------------- requests
const norm=(t:string)=>t.toLowerCase().replace(/[ً-ْ]/g,"").replace(/[أإآ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه");
const STORE_WORD=/(?:متجري|المتجر|متجر|ووكومرس|woocommerce|\bmy store\b|\bthe store\b|\bshop\b)/iu;
const CHANGE=/(?:^|\s)(?:غير|عدل|خفض|ارفع|زود|نزل|اجعل|حدث|ضع|حط|خلي|change|set|update|lower|raise|reduce|increase|mark)(?=\s)/iu;
const NEGATION=/غير\s+(?:ال)?(?:متوفر|موجود|متاح|مدفوع|مكتمل)/gu;
const CHANGE_TARGET=/(?:سعر|السعر|مخزون|المخزون|الكميه|كميه|خصم|حاله الطلب|الطلب رقم|طلب رقم|price|stock|quantity|sale|order\s*#?\d+)/iu;
/** "How many orders today in my store", "what is out of stock in the store": a read-only report. */
export function storeReportRequest(goal:string):boolean{
  const g=norm(goal);
  if(!STORE_WORD.test(g))return false;
  if(storeChangeRequest(goal))return false;
  return /(?:طلب|طلبات|مبيعات|مبيع|بعت|مخزون|نفد|نفذ|خلص|منتج|منتجات|تقرير|ملخص|دخل|ايراد|orders?|sales|sold|stock|products?|report|summary|revenue)/iu.test(g);
}
export function storeChangeRequest(goal:string):boolean{
  const g=norm(goal);
  return STORE_WORD.test(g)&&CHANGE.test(g.replace(NEGATION," "))&&CHANGE_TARGET.test(g);
}
/** "today" 1, "this week" 7, "this month" 30, "last N days" N. */
export function reportDays(goal:string):number{
  const g=norm(goal);
  const n=/(?:اخر|last|past)\s*(\d{1,3})\s*(?:يوم|ايام|days?)/iu.exec(g);if(n)return Math.min(90,Number(n[1]));
  if(/(?:الشهر|شهر|month)/iu.test(g))return 30;
  if(/(?:الاسبوع|اسبوع|week)/iu.test(g))return 7;
  if(/(?:امس|البارحه|yesterday)/iu.test(g))return 2;
  return 1;
}

const CHANGE_SCHEMA={type:"object",properties:{kind:{type:"string",enum:["product","order"]},n:{type:"integer"},order:{type:"string"},regular_price:{type:"string"},sale_price:{type:"string"},stock_quantity:{type:"integer"},order_status:{type:"string",enum:["processing","on-hold","completed"]},missing:{type:"string"}},required:["kind"]};
export function changePrompt(goal:string,products:WooProduct[]):string{
  return["The owner wants one change in their WooCommerce store. Return ONLY JSON:",
    '{"kind":"product" or "order","n":product number from the list,"regular_price":"new price","sale_price":"new sale price","stock_quantity":new stock,"order":"order number","order_status":"processing|on-hold|completed","missing":"what the request does not say"}',
    "Fill only what the request asks to change, with numbers copied from the request (no currency). A discount or offer price is sale_price; the normal price is regular_price. \"Mark order 1042 as shipped/delivered/done\" is order_status completed.",
    "The request:\n"+goal.slice(0,800),
    products.length?"The products the request may mean (untrusted store text):\n"+products.slice(0,150).map((p,i)=>`${i+1}. ${p.name} | sku ${p.sku||"-"} | price ${p.regular_price||p.price}${p.sale_price?" sale "+p.sale_price:""} | stock ${p.manage_stock?p.stock_quantity:p.stock_status}`).join("\n"):"No product in the store matches the request's words."
  ].join("\n\n");
}
const digitsOf=(t:string)=>t.replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[۰-۹]/g,d=>String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)));
/** A number the owner never wrote must not reach their store (a small model may guess a price). */
export function numberInRequest(value:string|number,goal:string):boolean{
  const v=String(value).trim();if(!/^\d+(?:\.\d+)?$/.test(v))return false;
  return digitsOf(goal).match(/\d+(?:\.\d+)?/g)?.some(n=>Number(n)===Number(v))??false;
}
/** Words in many product names and in the requests themselves ("the product", "price"): they say nothing about which product. */
const GENERIC_WORDS=new Set(["منتج","منتجات","سعر","مخزون","متجر","جرام","غرام","كيلو","حبه","علبه","product","products","price","stock","store","gram","pack","item"]);
/** How strongly the request names this product: its SKU (strongest), or how many distinctive words of its name it contains. */
export function nameScore(p:WooProduct,goal:string):number{
  const g=norm(digitsOf(goal));
  if(p.sku&&p.sku.length>2&&g.includes(p.sku.toLowerCase()))return 100;
  const words=[...new Set(norm(p.name).split(/[^\p{L}\p{N}]+/u).filter(w=>w.length>2&&!/^\d+$/.test(w)&&!GENERIC_WORDS.has(w.replace(/^ال/,""))))];
  return words.filter(w=>g.includes(w)||g.includes(w.replace(/^ال/,""))).length;
}
export function productNamed(p:WooProduct,goal:string):boolean{return nameScore(p,goal)>0;}
/** The products the request names best (seen live: a 7B model given 230 products answered with the wrong number). */
export function namedProducts(products:WooProduct[],goal:string):WooProduct[]{
  const scored=products.map(p=>({p,s:nameScore(p,goal)})).filter(x=>x.s>0);
  const best=Math.max(0,...scored.map(x=>x.s));
  return scored.filter(x=>x.s===best).map(x=>x.p).slice(0,20);
}
export interface PlannedChange{kind:"product"|"order";product?:WooProduct;orderNumber?:string;change:{regular_price?:string;sale_price?:string;stock_quantity?:number};orderStatus?:string}
export function parseChange(raw:unknown,goal:string,products:WooProduct[]):PlannedChange{
  const m=raw as Record<string,unknown>|null;
  if(!m||typeof m!=="object")throw new Error("The change could not be worked out from the request.");
  if(m.kind==="order"){
    const order=String(m.order??"").replace(/\D/g,"");
    if(!order||!numberInRequest(order,goal))throw new Error("Say which order number to change.");
    const status=String(m.order_status??"");
    if(!SAFE_ORDER_STATUS.has(status))throw new Error("Say the new status: processing, on hold or completed. Cancelling and refunds are done by the owner in WooCommerce.");
    return{kind:"order",orderNumber:order,change:{},orderStatus:status};
  }
  // One product named: it is that one, whatever number the model wrote.
  const product=products.length===1?products[0]:products[Number(m.n)-1];
  if(!product||!productNamed(product,goal))throw new Error("Which product? Name it as it appears in the store, or give its SKU."+(typeof m.missing==="string"&&m.missing?" ("+m.missing.slice(0,200)+")":""));
  const change:PlannedChange["change"]={};
  for(const k of ["regular_price","sale_price"] as const){const v=m[k];if(v!==undefined&&v!==null&&String(v).trim()){if(!numberInRequest(String(v),goal))throw new Error(`The ${k==="sale_price"?"sale price":"price"} ${v} is not in the request; say the exact number.`);change[k]=String(Number(v));}}
  if(m.stock_quantity!==undefined&&m.stock_quantity!==null){if(!numberInRequest(Number(m.stock_quantity),goal))throw new Error("Say the exact stock number.");change.stock_quantity=Number(m.stock_quantity);}
  if(!Object.keys(change).length)throw new Error("The request does not say what to change (price, sale price or stock).");
  return{kind:"product",product,change};
}
/**
 * "Mark order 1045 as completed" / "اجعل الطلب رقم 1045 مكتمل": the wording is fixed enough that code reads it (seen live:
 * the model called it a product change). Cancel and refund are refused here, before anything else runs.
 */
export function orderChangeFrom(goal:string):PlannedChange|null{
  const g=norm(digitsOf(goal));
  const number=/(?:الطلب|طلب|طلبيه|الطلبيه|order)\s*(?:رقم|no\.?|number|#)?\s*#?\s*(\d{2,})/iu.exec(g)?.[1];
  if(!number)return null;
  if(/(?:الغ|الغاء|ملغي|ملغى|استرجاع|استرداد|ارجع المبلغ|cancel|refund)/iu.test(g))throw new Error("LayanX does not cancel or refund orders: that moves the customer's money, so the owner does it in WooCommerce.");
  const status=/(?:مكتمل|اكتمل|تم التوصيل|وصل|سلم|تم الشحن|شحن|مشحون|منتهي|خلص|complete|completed|delivered|shipped|done)/iu.test(g)?"completed"
    :/(?:معلق|علق|انتظار|on.?hold|hold)/iu.test(g)?"on-hold":/(?:قيد التجهيز|تجهيز|processing)/iu.test(g)?"processing":null;
  if(!status)throw new Error(`Say the new status for order ${number}: completed, on hold or processing.`);
  return{kind:"order",orderNumber:number,change:{},orderStatus:status};
}
/**
 * Which value and what number, read by code (seen live: a 7B model filled every field of the schema, "sale_price":"45").
 * The field comes from the words (offer/discount -> sale price, stock/quantity -> stock, otherwise the price); the number is
 * the one the request gives that is not part of the product's own name ("500 جرام") — after "إلى/to" when there are several.
 */
export function productChangeFrom(goal:string,product:WooProduct):PlannedChange["change"]{
  const g=norm(digitsOf(goal));
  const field:"regular_price"|"sale_price"|"stock_quantity"=/(?:مخزون|كميه|الكميه|عدد القطع|stock|quantity|qty)/iu.test(g)?"stock_quantity"
    :/(?:سعر العرض|عرض|تخفيض مؤقت|سعر الخصم|خصم|sale|offer|discount)/iu.test(g)?"sale_price":"regular_price";
  const own=new Set((norm(digitsOf(product.name+" "+(product.sku??""))).match(/\d+(?:\.\d+)?/g)??[]).map(Number));
  const numbers=(g.match(/\d+(?:\.\d+)?/g)??[]).map(Number).filter(n=>!own.has(n));
  const after=/(?:الي|الى|لـ|ل|to|=|يصير|ليصبح|يكون|بـ|ب)\s*(\d+(?:\.\d+)?)/iu.exec(g.replace(/\s+/g," "));
  const value=after&&!own.has(Number(after[1]))?Number(after[1]):numbers.length===1?numbers[0]:undefined;
  if(value===undefined)throw new Error(numbers.length?"Several numbers in the request; say the new "+(field==="stock_quantity"?"stock":"price")+" as \"to N\".":"Say the exact new "+(field==="stock_quantity"?"stock number":"price")+".");
  if(field==="stock_quantity"){if(!Number.isInteger(value))throw new Error("Stock must be a whole number.");return{stock_quantity:value};}
  // An offer at or above the normal price is a mistake (WooCommerce drops it too): say so instead of sending it.
  const regular=Number(product.regular_price||product.price);
  if(field==="sale_price"&&regular>0&&value>=regular)throw new Error(`The offer price ${value} is not below the normal price ${regular}. To change the normal price, say "price to ${value}".`);
  return{[field]:String(value)};
}
export async function planChange(goal:string,client:WooClient,think:(prompt:string,schema:Record<string,unknown>)=>Promise<string>):Promise<PlannedChange>{
  const order=orderChangeFrom(goal);
  if(order)return order;
  const named=namedProducts(await client.products(),goal);
  if(!named.length)throw new Error("Which product? Name it as it appears in the store, or give its SKU.");
  // One product named: no model at all. Several: the model only chooses which, the value is still read by code.
  let product=named[0]!;
  if(named.length>1){
    const picked=extractJson(await think(changePrompt(goal,named),CHANGE_SCHEMA)) as {n?:unknown}|null;
    const p=named[Number(picked?.n)-1];
    if(!p)throw new Error("Several products match: "+named.slice(0,5).map(x=>x.name).join("، ")+". Say which one.");
    product=p;
  }
  return{kind:"product",product,change:productChangeFrom(goal,product)};
}
/** Carries out a planned change and reads it back from the store. */
export async function applyChange(plan:PlannedChange,client:WooClient){
  if(plan.kind==="order"){
    const orders=await client.ordersSince(new Date(Date.now()-90*86400_000));
    const order=orders.find(o=>String(o.number)===plan.orderNumber||String(o.id)===plan.orderNumber);
    if(!order)throw new Error(`Order ${plan.orderNumber} is not among the store's orders of the last 90 days.`);
    const after=await client.setOrderStatus(order.id,plan.orderStatus!);
    return{kind:"order" as const,order:plan.orderNumber,before:order.status,after:after.status,verified:after.status===plan.orderStatus};
  }
  const p=plan.product!;
  const after=await client.updateProduct(p.id,plan.change);
  const verified=Object.entries(plan.change).every(([k,v])=>String((after as unknown as Record<string,unknown>)[k])===String(v));
  return{kind:"product" as const,product:p.name,before:{regular_price:p.regular_price,sale_price:p.sale_price,stock_quantity:p.stock_quantity},after:{regular_price:after.regular_price,sale_price:after.sale_price,stock_quantity:after.stock_quantity},verified};
}

/** The store tools' messages in the owner's language (the owner reads them when a change could not be made). */
const ARABIC:Array<[RegExp,(m:RegExpExecArray)=>string]>=[
  [/^Which product\?/,()=>"أي منتج؟ اكتب اسمه كما هو في المتجر، أو رمز SKU الخاص به."],
  [/^Several products match: (.*)\. Say which one\./,m=>`أكثر من منتج يطابق طلبك: ${m[1]}. حدّد أيها تقصد.`],
  [/^Several numbers in the request; say the new (\w+)/,m=>`في طلبك أكثر من رقم؛ اكتب ${m[1]==="stock"?"المخزون الجديد":"السعر الجديد"} بصيغة «إلى رقم».`],
  [/^Say the exact new stock number/,()=>"اكتب رقم المخزون الجديد بالضبط."],
  [/^Say the exact new price/,()=>"اكتب السعر الجديد بالضبط، مثل: «إلى 40»."],
  [/^Stock must be a whole number/,()=>"المخزون يجب أن يكون عدداً صحيحاً."],
  [/^The offer price (\S+) is not below the normal price (\S+)\./,m=>`سعر العرض ${m[1]} ليس أقل من السعر العادي ${m[2]}. إن أردت تغيير السعر العادي فقل: «السعر إلى ${m[1]}».`],
  [/does not (?:cancel or refund|set orders to)/,()=>"لا يلغي LayanX الطلبات ولا يسترجع مبالغها، لأن ذلك يحرّك مال العميل. افعل ذلك بنفسك من WooCommerce."],
  [/^Say the new status for order (\d+)/,m=>`اكتب الحالة الجديدة للطلب ${m[1]}: مكتمل، أو معلّق، أو قيد التجهيز.`],
  [/^Order (\d+) is not among/,m=>`الطلب ${m[1]} ليس بين طلبات المتجر في آخر 90 يوماً.`],
  [/^Changing the store is off/,()=>"تعديل المتجر مغلق. لتفعيله أضف LAYANX_WOOCOMMERCE_ALLOW_WRITES بقيمة on في اللوحة (الإعداد ← الأسرار)، وتأكد أن المفاتيح بصلاحية قراءة وكتابة."],
  [/^The store is not connected/,()=>"المتجر غير مربوط. أضف في اللوحة (الإعداد ← الأسرار): LAYANX_WOOCOMMERCE_URL (عنوان المتجر)، وLAYANX_WOOCOMMERCE_CONSUMER_KEY وLAYANX_WOOCOMMERCE_CONSUMER_SECRET من WooCommerce ← الإعدادات ← متقدم ← REST API. صلاحية القراءة تكفي للتقارير."],
  [/^The store refused the keys \(([^)]*)\)/,m=>`رفض المتجر المفاتيح (${m[1]}). تحقق من المفتاح والسر، ومن صلاحيتهما.`],
  [/^Say the order number for the invoice/,()=>"اكتب رقم الطلب الذي تريد فاتورته."],
  [/^Order (\d+) has no shipment yet/,m=>`الطلب ${m[1]} ليس له شحنة بعد. قل أولاً: «جهّز شحنات طلبات المتجر».`],
  [/^Order (\d+): its lines, shipping and tax add up to (\S+), but the store's total is (\S+)\./,m=>`الطلب ${m[1]}: مجموع منتجاته والشحن والضريبة ${m[2]}، لكن إجمالي المتجر ${m[3]}. راجع الطلب في WooCommerce قبل إصدار الفاتورة.`],
  [/^The store did not keep order (\d+) as completed \(it shows (\S+)\)/,m=>`المتجر لم يحتفظ بالطلب ${m[1]} مكتملاً (حالته الآن ${m[2]}).`],
  [/^The store did not keep the change/,()=>"أرسلتُ التعديل لكن المتجر لم يحتفظ به عند قراءته بعد التعديل؛ راجعه في WooCommerce."]
];
export function storeMessage(message:string,arabic:boolean):string{
  if(!arabic)return message;
  for(const[re,ar]of ARABIC){const m=re.exec(message);if(m)return ar(m);}
  return message;
}
