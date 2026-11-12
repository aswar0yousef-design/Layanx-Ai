import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolRequest} from "../core/types.js";
import {WooClient,WOO_SETUP_HINT,applyChange,planChange,reportDays,storeMessage,storeReport,wooConfig,type Fetcher} from "./woocommerce.js";
const inArabic=(t:string)=>/[؀-ۿ]/.test(t);
/** Runs a store step and gives its failure in the owner's language. */
async function owned<T>(goal:string,work:()=>Promise<T>):Promise<T>{try{return await work();}catch(error){throw new Error(storeMessage(error instanceof Error?error.message:String(error),inArabic(goal)));}}

/** store.report reads the owner's WooCommerce store; store.change makes one approved change and reads it back. */
export function registerWooTools(core:LayanXCore,deps:{env?:NodeJS.ProcessEnv;fetcher?:Fetcher}={}):void{
  const client=()=>{const c=wooConfig(deps.env??process.env);if(!c)throw new Error(WOO_SETUP_HINT);return new WooClient(c,deps.fetcher);};
  const think=async(prompt:string,schema:Record<string,unknown>)=>(await core.modelExecution.execute({capability:"reasoning",input:prompt,maxOutputTokens:400,responseSchema:schema,routing:{preferLocal:true}} as never)).output;
  core.tools.register({name:"store.report",description:"read the owner's WooCommerce store: orders and sales for today / this week / this month, orders waiting to ship, best sellers, out-of-stock and low-stock products. payload.days or payload.goal.",
    permission:"L1_READ",dangerous:false,actions:["store report","تقرير المتجر"],tags:["store","woocommerce","orders","sales","stock","متجر","طلبات","مبيعات","مخزون"]});
  core.toolAdapters.register("store.report",{async execute(request:ToolRequest){
    const p=request.payload&&typeof request.payload==="object"?request.payload as Record<string,unknown>:{};
    const days=Number.isFinite(Number(p.days))&&Number(p.days)>0?Math.min(90,Number(p.days)):reportDays(String(p.goal??""));
    return owned(String(p.goal??""),()=>storeReport(client(),days));
  }});
  core.tools.register({name:"store.change",description:"make ONE change in the owner's WooCommerce store (a product's price, sale price or stock, or an order's status to processing / on-hold / completed) and read it back from the store. payload.goal = the owner's words.",
    permission:"L4_EXECUTE",dangerous:true,actions:["change store","تعديل المتجر"],tags:["store","woocommerce","price","stock","order","متجر","سعر","مخزون"]});
  core.toolAdapters.register("store.change",{async execute(request:ToolRequest){
    const p=request.payload&&typeof request.payload==="object"?request.payload as Record<string,unknown>:{};
    const goal=String(p.goal??"");
    return owned(goal,async()=>{
      const c=client();
      const result=await applyChange(await planChange(goal,c,think),c);
      // What the store holds afterwards must match the request, or the task is not done.
      if(!result.verified)throw new Error("The store did not keep the change: "+JSON.stringify(result.after));
      return result;
    });
  }});
}
