import path from "node:path";
import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolRequest} from "../core/types.js";
import type {ShippingDesk} from "./shipping.js";
import {WooClient,WOO_SETUP_HINT,storeMessage,wooConfig,type Fetcher} from "./woocommerce.js";
import {buildInvoice,closeDeliveredOrders,saveInvoice,sellerFrom,shipmentsFromStore} from "./store-shipping.js";
import {sharedBrowser} from "../autonomy/browser-test.js";

const inArabic=(t:string)=>/[؀-ۿ]/.test(t);
const payloadOf=(r:ToolRequest)=>r.payload&&typeof r.payload==="object"?r.payload as Record<string,unknown>:{};
async function owned<T>(goal:string,work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){throw new Error(storeMessage(error instanceof Error?error.message:String(error),inArabic(goal)));}}

/** Store orders -> shipments, delivered -> order completed (approved), and the customer's invoice as a file. */
export function registerStoreShippingTools(core:LayanXCore,desk:ShippingDesk,deps:{env?:NodeJS.ProcessEnv;fetcher?:Fetcher;invoiceDir?:string;openBrowser?:()=>Promise<any>}={}):void{
  const env=()=>deps.env??process.env;
  const client=()=>{const c=wooConfig(env());if(!c)throw new Error(WOO_SETUP_HINT);return new WooClient(c,deps.fetcher);};
  const invoiceDir=()=>deps.invoiceDir??path.join(env().LAYANX_STORE_DIR?.trim()||".layanx","invoices");
  const tools:Array<{name:string;description:string;permission:"L1_READ"|"L3_MODIFY"|"L4_EXECUTE";dangerous:boolean;run:(p:Record<string,unknown>)=>Promise<unknown>}>=[
    {name:"shipping.from_store",permission:"L3_MODIFY",dangerous:false,
     description:"prepare draft shipments for the store's orders that are waiting to ship: cheapest carrier for the city, weight from the products, cash on delivery from the payment method. Lists orders it could not prepare and why.",
     run:p=>owned(String(p.goal??""),()=>shipmentsFromStore(client(),desk))},
    {name:"shipping.invoice.document",permission:"L3_MODIFY",dangerous:false,
     description:"write the customer's invoice for an order (payload.order = order number) as an HTML and PDF file, from the order's lines and totals in the store.",
     run:p=>owned(String(p.goal??""),async()=>{
       const number=String(p.order??"").replace(/\D/g,"");
       if(!number)throw new Error("Say the order number for the invoice.");
       const shipment=desk.list().find(s=>s.orderId===number&&s.status!=="cancelled");
       if(!shipment)throw new Error(`Order ${number} has no shipment yet. Ask to prepare the shipments for the store's orders first.`);
       const c=wooConfig(env());
       const order=c?(await new WooClient(c,deps.fetcher).ordersSince(new Date(Date.now()-365*86400_000))).find(o=>String(o.number??o.id)===number):undefined;
       const doc=buildInvoice(desk,shipment,order,sellerFrom(env()));
       const files=await saveInvoice(doc,invoiceDir(),deps.openBrowser??sharedBrowser);
       return{invoice:doc.number,order:number,total:doc.total,currency:doc.currency,fromStore:doc.fromStore,sellerMissing:!doc.seller.name,...files};
     })},
    {name:"shipping.store.close",permission:"L4_EXECUTE",dangerous:true,
     description:"set the store orders whose shipments were delivered to completed in WooCommerce, and read them back.",
     run:p=>owned(String(p.goal??""),()=>closeDeliveredOrders(client(),desk))}
  ];
  for(const tool of tools){
    core.tools.register({name:tool.name,description:tool.description,permission:tool.permission,dangerous:tool.dangerous,actions:[tool.name],tags:["business","shipping","store","invoice","شحن","فاتورة"]});
    core.toolAdapters.register(tool.name,{async execute(request:ToolRequest){return tool.run(payloadOf(request));}});
  }
}
