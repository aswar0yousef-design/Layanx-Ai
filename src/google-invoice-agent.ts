import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {dirname,resolve} from "node:path";
import type {ToolRequest} from "./core/types.js";
import type {LayanXCore} from "./core/orchestrator.js";
import {createGoogleWorkspaceAdapter} from "./connectors/google-workspace.js";

type Invoice={company:string;invoiceNumber:string;date:string;amount:number|string;currency?:string;sender:string;recipient:string;shipmentNumber?:string;orderNumber?:string;status?:string};
function obj(v:unknown):Record<string,unknown>{return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{}}
function json(text:string):Invoice{const m=text.match(/\{[\s\S]*\}/);if(!m)throw new Error("Model did not return JSON.");const x=obj(JSON.parse(m[0]));if(typeof x.company!=="string"||typeof x.invoiceNumber!=="string")throw new Error("Invoice extraction missing company or invoiceNumber.");return x as unknown as Invoice}
function safe(v:string){return v.trim().slice(0,200)}
export class GoogleInvoiceAgent{
 constructor(private readonly core:LayanXCore,private readonly adapter= createGoogleWorkspaceAdapter({accessToken:process.env.GOOGLE_ACCESS_TOKEN,clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,refreshToken:process.env.GOOGLE_REFRESH_TOKEN}),private readonly registryPath=process.env.LAYANX_GOOGLE_INVOICE_REGISTRY??".layanx/google-invoices.json"){}
 private registry():Record<string,true>{try{return JSON.parse(readFileSync(this.registryPath,"utf8")) as Record<string,true>}catch{return {}}}
 private save(r:Record<string,true>){mkdirSync(dirname(resolve(this.registryPath)),{recursive:true});writeFileSync(this.registryPath,JSON.stringify(r,null,2)+"\n","utf8")}
 async scan(input:{query?:string;limit?:number;sheetMap?:Record<string,string>}):Promise<{scanned:number;written:number;duplicates:number;errors:string[]}>{
  const q=input.query??"newer_than:7d (invoice OR فاتورة OR shipment OR شحن)";
  const list=await this.adapter.execute({toolName:"google.gmail.search",action:"search emails",payload:{query:q,limit:Math.min(Math.max(input.limit??20,1),50)},missionId:"google-invoice",requestId:randomUUID()} as ToolRequest) as {messages?:Array<{id:string}>};
  const registry=this.registry();let written=0,duplicates=0;const errors:string[]=[];
  for(const m of list.messages??[]){try{
   const mail=await this.adapter.execute({toolName:"google.gmail.read",action:"read email",payload:{messageId:m.id},missionId:"google-invoice",requestId:randomUUID()} as ToolRequest);
   const prompt="Extract a shipping/store invoice from this Gmail message. Return ONLY JSON with company, invoiceNumber, date, amount, currency, sender, recipient, shipmentNumber, orderNumber, status. Do not invent values; use empty strings when absent. Message:\n"+JSON.stringify(mail);
   const out=(await this.core.modelExecution.execute({capability:"chat",input:prompt,maxOutputTokens:500,routing:{preferLocal:true}})).output;
   const inv=json(out);const key=safe(inv.company)+"|"+safe(inv.invoiceNumber);if(registry[key]){duplicates++;continue}
   const sheetId=input.sheetMap?.[inv.company];if(!sheetId)throw new Error("No Sheet mapping for company: "+inv.company);
   const row=[[inv.invoiceNumber,inv.date,inv.amount,inv.currency??"",inv.sender,inv.recipient,inv.shipmentNumber??"",inv.orderNumber??"",inv.status??"",m.id]];
   await this.adapter.execute({toolName:"google.sheets.append",action:"append sheet rows",payload:{spreadsheetId:sheetId,range:"Invoices!A:J",values:row},missionId:"google-invoice",requestId:randomUUID()} as ToolRequest);
   registry[key]=true;written++;
  }catch(e){errors.push(m.id+": "+(e instanceof Error?e.message:"unknown error"))}}
  this.save(registry);return{scanned:list.messages?.length??0,written,duplicates,errors};
 }
}
export function registerGoogleInvoiceTool(core:LayanXCore,agent:GoogleInvoiceAgent):void{
 core.tools.register({name:"google.invoices.scan",description:"scan Gmail for invoice messages, extract structured fields with the local model, and append verified non-duplicate rows to company-specific Google Sheets",permission:"L3_MODIFY",dangerous:false,actions:["scan invoices","organize invoices","فحص الفواتير","تنظيم الفواتير"],tags:["google","gmail","invoice","sheets","shipping","فاتورة","شحن"]});
 core.toolAdapters.register("google.invoices.scan",{async execute(request:ToolRequest){const p=obj(request.payload);let map:Record<string,string>|undefined;if(typeof p.sheetMapJson==="string")map=JSON.parse(p.sheetMapJson);return agent.scan({query:typeof p.query==="string"?p.query:undefined,limit:typeof p.limit==="number"?p.limit:undefined,sheetMap:map});}});
}