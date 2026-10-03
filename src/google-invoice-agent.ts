import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {dirname,resolve} from "node:path";
import type {ToolRequest} from "./core/types.js";
import type {LayanXCore} from "./core/orchestrator.js";
import {createGoogleWorkspaceAdapter} from "./connectors/google-workspace.js";
import {createYahooMailAdapter} from "./connectors/yahoo-mail.js";

type Invoice={company:string;invoiceNumber:string;date:string;amount:number|string;currency?:string;sender:string;recipient:string;shipmentNumber?:string;orderNumber?:string;status?:string};
type Registry={invoices:Record<string,true>;companies:Record<string,{spreadsheetId:string;folderId?:string}>};
function obj(v:unknown):Record<string,unknown>{return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{}}
function json(text:string):Invoice{const m=text.match(/\{[\s\S]*\}/);if(!m)throw new Error("Model did not return JSON.");const x=obj(JSON.parse(m[0]));if(typeof x.company!=="string"||typeof x.invoiceNumber!=="string")throw new Error("Invoice extraction missing company or invoiceNumber.");return x as unknown as Invoice}
function safe(v:string){return v.trim().slice(0,200)}
function emptyRegistry():Registry{return{invoices:{},companies:{}}}
function readRegistry(path:string):Registry{try{const raw=JSON.parse(readFileSync(path,"utf8")) as Record<string,unknown>;if(raw.invoices&&raw.companies)return raw as unknown as Registry;const invoices:Record<string,true>={};for(const [k,v] of Object.entries(raw))if(v===true)invoices[k]=true;return{invoices,companies:{}}}catch{return emptyRegistry()}}
function writeRegistry(path:string,r:Registry){mkdirSync(dirname(resolve(path)),{recursive:true});writeFileSync(path,JSON.stringify(r,null,2)+"\n","utf8")}

export class GoogleInvoiceAgent{
 constructor(private readonly core:LayanXCore,private readonly adapter=createGoogleWorkspaceAdapter({accessToken:process.env.GOOGLE_ACCESS_TOKEN,clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,refreshToken:process.env.GOOGLE_REFRESH_TOKEN}),private readonly registryPath=process.env.LAYANX_GOOGLE_INVOICE_REGISTRY??".layanx/google-invoices.json"){}
 private registry(){return readRegistry(this.registryPath)}
 private save(r:Registry){writeRegistry(this.registryPath,r)}
 private async findFolder(name:string,parentId?:string){
  const q="name='"+name.replace(/'/g,"\\'")+"' and mimeType='application/vnd.google-apps.folder' and trashed=false"+(parentId?" and '"+parentId+"' in parents":"");
  const out=await this.adapter.execute({tool:"google.drive.list",action:"list drive",payload:{query:q,limit:5},missionId:"google-invoice",idempotencyKey:randomUUID()} as ToolRequest) as {files?:Array<{id:string}>};
  return out.files?.[0]?.id;
 }
 private async ensureFolder(name:string,parentId?:string){
  const found=await this.findFolder(name,parentId);if(found)return found;
  const out=await this.adapter.execute({tool:"google.drive.folder.create",action:"create drive folder",payload:{name,parents:parentId?[parentId]:undefined},missionId:"google-invoice",idempotencyKey:randomUUID()} as ToolRequest) as {id?:string};
  if(!out.id)throw new Error("Google Drive did not return a folder id.");return out.id;
 }
 private async ensureCompanySheet(company:string,registry:Registry,provided?:string){
  if(provided)return provided;
  const existing=registry.companies[company]?.spreadsheetId;if(existing)return existing;
  const root=await this.ensureFolder("LayanX Business");
  const shipping=await this.ensureFolder("Shipping Companies",root);
  const companyFolder=await this.ensureFolder(company,shipping);
  const created=await this.adapter.execute({tool:"google.sheets.create",action:"create spreadsheet",payload:{title:company+" - Invoices"},missionId:"google-invoice",idempotencyKey:randomUUID()} as ToolRequest) as {spreadsheetId?:string};
  if(!created.spreadsheetId)throw new Error("Google Sheets did not return a spreadsheetId.");
  await this.adapter.execute({tool:"google.drive.file.organize",action:"organize drive file",payload:{fileId:created.spreadsheetId,folderId:companyFolder},missionId:"google-invoice",idempotencyKey:randomUUID()} as ToolRequest);
  await this.adapter.execute({tool:"google.sheets.append",action:"append sheet rows",payload:{spreadsheetId:created.spreadsheetId,range:"Invoices!A1:J1",values:[["Invoice Number","Date","Amount","Currency","Sender","Recipient","Shipment Number","Order Number","Status","Source Message"]]},missionId:"google-invoice",idempotencyKey:randomUUID()} as ToolRequest);
  registry.companies[company]={spreadsheetId:created.spreadsheetId,folderId:companyFolder};this.save(registry);return created.spreadsheetId;
 }
 async scan(input:{query?:string;limit?:number;sheetMap?:Record<string,string>;provider?:"google"|"yahoo"}):Promise<{scanned:number;written:number;duplicates:number;errors:string[]}>{
  const q=input.query??"invoice OR فاتورة OR shipment OR شحن";const mailAdapter=input.provider==="yahoo"?createYahooMailAdapter():this.adapter;
  const list=await mailAdapter.execute({tool:input.provider==="yahoo"?"yahoo.mail.search":"google.gmail.search",action:input.provider==="yahoo"?"search yahoo mail":"search emails",payload:{query:q,limit:Math.min(Math.max(input.limit??20,1),50)},missionId:"google-invoice",idempotencyKey:randomUUID()} as ToolRequest) as {messages?:Array<{id:string}>};
  const registry=this.registry();let written=0,duplicates=0;const errors:string[]=[];
  for(const m of list.messages??[]){try{
   const mail=await mailAdapter.execute({tool:input.provider==="yahoo"?"yahoo.mail.read":"google.gmail.read",action:input.provider==="yahoo"?"read yahoo mail":"read email",payload:{messageId:m.id},missionId:"google-invoice",idempotencyKey:randomUUID()} as ToolRequest);
   const out=(await this.core.modelExecution.execute({capability:"chat",input:"Extract a shipping/store invoice from this email message. Return ONLY JSON with company, invoiceNumber, date, amount, currency, sender, recipient, shipmentNumber, orderNumber, status. Do not invent values; use empty strings when absent. Message:\n"+JSON.stringify(mail),maxOutputTokens:500,routing:{preferLocal:true}})).output;
   const inv=json(out);const key=safe(inv.company)+"|"+safe(inv.invoiceNumber);if(registry.invoices[key]){duplicates++;continue}
   const sheetId=await this.ensureCompanySheet(inv.company,registry,input.sheetMap?.[inv.company]);
   const row=[[inv.invoiceNumber,inv.date,inv.amount,inv.currency??"",inv.sender,inv.recipient,inv.shipmentNumber??"",inv.orderNumber??"",inv.status??"",m.id]];
   const appended=await this.adapter.execute({tool:"google.sheets.append",action:"append sheet rows",payload:{spreadsheetId:sheetId,range:"Invoices!A:J",values:row},missionId:"google-invoice",idempotencyKey:randomUUID() } as ToolRequest) as {updates?:{updatedRows?:number}};
   if((appended.updates?.updatedRows??0)<1)throw new Error("Google Sheets did not confirm the invoice row write.");
   registry.invoices[key]=true;written++;this.save(registry);
  }catch(e){errors.push(m.id+": "+(e instanceof Error?e.message:"unknown error"))}}
  this.save(registry);return{scanned:list.messages?.length??0,written,duplicates,errors};
 }
}
export function registerGoogleInvoiceTool(core:LayanXCore,agent:GoogleInvoiceAgent):void{
 core.tools.register({name:"email.invoices.scan",description:"scan Gmail or Yahoo Mail for invoice messages, extract structured fields with the local model, create or reuse a company-specific Google Sheet and Drive folder, and append verified non-duplicate rows",permission:"L3_MODIFY",dangerous:false,actions:["scan invoices","organize invoices","فحص الفواتير","تنظيم الفواتير"],tags:["google","yahoo","gmail","invoice","sheets","drive","shipping","فاتورة","شحن"]});
 core.toolAdapters.register("email.invoices.scan",{async execute(request:ToolRequest){const p=obj(request.payload);let map:Record<string,string>|undefined;if(typeof p.sheetMapJson==="string")map=JSON.parse(p.sheetMapJson);return agent.scan({query:typeof p.query==="string"?p.query:undefined,limit:typeof p.limit==="number"?p.limit:undefined,sheetMap:map,provider:p.provider==="yahoo"?"yahoo":"google"});}});
}