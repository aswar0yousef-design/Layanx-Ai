import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {dirname,resolve} from "node:path";
import type {ToolRequest} from "./core/types.js";
import type {LayanXCore} from "./core/orchestrator.js";
import type {ToolAdapter} from "./tools/executor.js";
import {createGoogleWorkspaceAdapter} from "./connectors/google-workspace.js";
import {createYahooMailAdapter} from "./connectors/yahoo-mail.js";
import {gmailText,mimeText,readInvoice,type MailText} from "./business/mail-invoices.js";

/**
 * Invoices from Gmail or Yahoo into one Google Sheet per issuing company (LayanX Business / Shipping Companies / <company>).
 * The email is decoded to text before the model reads it, every value must be in the email, a row is only counted once
 * Google has it (read back), and the same invoice is never written twice (the local registry, and the sheet itself).
 */
type Registry={invoices:Record<string,true>;companies:Record<string,{spreadsheetId:string;folderId?:string}>};
function obj(v:unknown):Record<string,unknown>{return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{}}
function safe(v:string){return v.trim().slice(0,200)}
function emptyRegistry():Registry{return{invoices:{},companies:{}}}
function readRegistry(path:string):Registry{try{const raw=JSON.parse(readFileSync(path,"utf8")) as Record<string,unknown>;if(raw.invoices&&raw.companies)return raw as unknown as Registry;const invoices:Record<string,true>={};for(const [k,v] of Object.entries(raw))if(v===true)invoices[k]=true;return{invoices,companies:{}}}catch{return emptyRegistry()}}
function writeRegistry(path:string,r:Registry){mkdirSync(dirname(resolve(path)),{recursive:true});writeFileSync(path,JSON.stringify(r,null,2)+"\n","utf8")}
const SHEET="Invoices";
const HEADER=["Invoice Number","Date","Amount","Currency","Company","Shipment Number","Order Number","From","Subject","Message ID"];

export interface ScanReport{scanned:number;written:Array<{company:string;invoiceNumber:string;amount:string;currency:string;sheet:string}>;duplicates:Array<{company:string;invoiceNumber:string}>;
  skipped:Array<{subject:string;reason:string}>;notInvoices:number;errors:string[];writtenCount:number}
export interface InvoiceAgentDeps{google?:ToolAdapter;yahoo?:ToolAdapter;registryPath?:string;think?:(prompt:string,schema:Record<string,unknown>)=>Promise<string>}

export class GoogleInvoiceAgent{
 private readonly adapter:ToolAdapter;private readonly registryPath:string;
 constructor(private readonly core:LayanXCore,private readonly deps:InvoiceAgentDeps={}){
  this.adapter=deps.google??createGoogleWorkspaceAdapter({accessToken:process.env.GOOGLE_ACCESS_TOKEN,clientId:process.env.GOOGLE_CLIENT_ID,clientSecret:process.env.GOOGLE_CLIENT_SECRET,refreshToken:process.env.GOOGLE_REFRESH_TOKEN});
  this.registryPath=deps.registryPath??process.env.LAYANX_GOOGLE_INVOICE_REGISTRY??".layanx/google-invoices.json";
 }
 private call(adapter:ToolAdapter,tool:string,action:string,payload:Record<string,unknown>){return adapter.execute({tool,action,payload,missionId:"google-invoice",idempotencyKey:randomUUID()} as ToolRequest) as Promise<any>;}
 private registry(){return readRegistry(this.registryPath)}
 private save(r:Registry){writeRegistry(this.registryPath,r)}
 private async findFolder(name:string,parentId?:string){
  const q="name='"+name.replace(/\\/g,"\\\\").replace(/'/g,"\\'")+"' and mimeType='application/vnd.google-apps.folder' and trashed=false"+(parentId?" and '"+parentId+"' in parents":"");
  const out=await this.call(this.adapter,"google.drive.list","list drive",{query:q,limit:5}) as {files?:Array<{id:string}>};
  return out.files?.[0]?.id;
 }
 private async ensureFolder(name:string,parentId?:string){
  const found=await this.findFolder(name,parentId);if(found)return found;
  const out=await this.call(this.adapter,"google.drive.folder.create","create drive folder",{name,parents:parentId?[parentId]:undefined}) as {id?:string};
  if(!out.id)throw new Error("Google Drive did not return a folder id.");return out.id;
 }
 private async ensureCompanySheet(company:string,registry:Registry,provided?:string){
  if(provided)return provided;
  const existing=registry.companies[company]?.spreadsheetId;if(existing)return existing;
  const root=await this.ensureFolder("LayanX Business");
  const shipping=await this.ensureFolder("Shipping Companies",root);
  const companyFolder=await this.ensureFolder(company,shipping);
  // The spreadsheet is created WITH its "Invoices" sheet: a new spreadsheet's only sheet is named "Sheet1" (or its translation),
  // so writing to "Invoices!A1" used to fail on every first invoice of a company.
  const created=await this.call(this.adapter,"google.sheets.create","create spreadsheet",{title:company+" - Invoices",sheetTitle:SHEET}) as {spreadsheetId?:string};
  if(!created.spreadsheetId)throw new Error("Google Sheets did not return a spreadsheetId.");
  await this.call(this.adapter,"google.drive.file.organize","organize drive file",{fileId:created.spreadsheetId,folderId:companyFolder});
  await this.call(this.adapter,"google.sheets.append","append sheet rows",{spreadsheetId:created.spreadsheetId,range:`${SHEET}!A1:J1`,values:[HEADER]});
  registry.companies[company]={spreadsheetId:created.spreadsheetId,folderId:companyFolder};this.save(registry);return created.spreadsheetId;
 }
 private async invoiceNumbersIn(sheetId:string):Promise<Set<string>>{
  const out=await this.call(this.adapter,"google.sheets.read","read sheet",{spreadsheetId:sheetId,range:`${SHEET}!A:A`}) as {values?:string[][]};
  return new Set((out.values??[]).map(r=>String(r[0]??"").trim()).filter(Boolean));
 }
 async scan(input:{query?:string;limit?:number;sheetMap?:Record<string,string>;provider?:"google"|"yahoo"}):Promise<ScanReport>{
  const yahoo=input.provider==="yahoo";
  const mail=yahoo?(this.deps.yahoo??createYahooMailAdapter()):this.adapter;
  const q=input.query??(yahoo?"invoice":"invoice OR فاتورة OR bill OR shipment OR شحن");
  const list=await this.call(mail,yahoo?"yahoo.mail.search":"google.gmail.search",yahoo?"search yahoo mail":"search emails",{query:q,limit:Math.min(Math.max(input.limit??20,1),50)}) as {messages?:Array<{id:string}>};
  const think=this.deps.think??(async(prompt:string,schema:Record<string,unknown>)=>(await this.core.modelExecution.execute({capability:"reasoning",input:prompt,maxOutputTokens:500,responseSchema:schema,routing:{preferLocal:true}} as never)).output);
  const registry=this.registry();
  const report:ScanReport={scanned:list.messages?.length??0,written:[],duplicates:[],skipped:[],notInvoices:0,errors:[],writtenCount:0};
  for(const m of list.messages??[]){
   let text:MailText|undefined;
   try{
    const raw=await this.call(mail,yahoo?"yahoo.mail.read":"google.gmail.read",yahoo?"read yahoo mail":"read email",{messageId:m.id});
    text=yahoo?mimeText(String(raw?.source??"")):gmailText(raw);
    if(!text.text.trim()){report.skipped.push({subject:text.subject,reason:text.attachments.length?"the invoice is in an attachment ("+text.attachments.map(a=>a.filename).join(", ")+"), which is not read yet":"the email has no readable text"});continue;}
    const checked=await readInvoice(text,think);
    if(checked.notInvoice){report.notInvoices++;continue;}
    if(!checked.invoice){
     // An invoice email whose text has no number or amount usually carries the invoice as an attachment: say where it is.
     const files=text.attachments.filter(a=>/pdf|image|spreadsheet|excel/i.test(a.mimeType)||/\.(pdf|png|jpe?g|xlsx?)$/i.test(a.filename));
     const missing=checked.problems.every(p=>/^no /.test(p));
     report.skipped.push({subject:text.subject,reason:files.length&&missing?"the invoice is in an attachment ("+files.map(a=>a.filename).join(", ")+"), which is not read yet":checked.problems.join("; ")});continue;
    }
    const inv=checked.invoice,key=safe(inv.company)+"|"+safe(inv.invoiceNumber);
    if(registry.invoices[key]){report.duplicates.push({company:inv.company,invoiceNumber:inv.invoiceNumber});continue;}
    const sheetId=await this.ensureCompanySheet(inv.company,registry,input.sheetMap?.[inv.company]);
    if((await this.invoiceNumbersIn(sheetId)).has(inv.invoiceNumber)){registry.invoices[key]=true;this.save(registry);report.duplicates.push({company:inv.company,invoiceNumber:inv.invoiceNumber});continue;}
    const row=[inv.invoiceNumber,inv.date,inv.amount,inv.currency,inv.company,inv.shipmentNumber,inv.orderNumber,text.from,text.subject,m.id];
    const appended=await this.call(this.adapter,"google.sheets.append","append sheet rows",{spreadsheetId:sheetId,range:`${SHEET}!A:J`,values:[row]}) as {updates?:{updatedRows?:number}};
    if((appended.updates?.updatedRows??0)<1)throw new Error("Google Sheets did not confirm the row.");
    // Counted only once the sheet really holds it.
    if(!(await this.invoiceNumbersIn(sheetId)).has(inv.invoiceNumber))throw new Error("the row was sent but the sheet does not show invoice "+inv.invoiceNumber);
    registry.invoices[key]=true;this.save(registry);
    report.written.push({company:inv.company,invoiceNumber:inv.invoiceNumber,amount:inv.amount,currency:inv.currency,sheet:"https://docs.google.com/spreadsheets/d/"+sheetId});
   }catch(e){report.errors.push((text?.subject||m.id)+": "+(e instanceof Error?e.message:"unknown error"));}
  }
  report.writtenCount=report.written.length;
  return report;
 }
}
export function registerGoogleInvoiceTool(core:LayanXCore,agent:GoogleInvoiceAgent):void{
 core.tools.register({name:"email.invoices.scan",description:"read invoice emails in Gmail or Yahoo Mail, check every value against the email, and add each new invoice to its company's Google Sheet (read back); payload.provider google|yahoo, payload.query, payload.limit",permission:"L3_MODIFY",dangerous:false,actions:["scan invoices","organize invoices","فحص الفواتير","تنظيم الفواتير"],tags:["google","yahoo","gmail","invoice","sheets","drive","shipping","فاتورة","شحن"]});
 core.toolAdapters.register("email.invoices.scan",{async execute(request:ToolRequest){const p=obj(request.payload);let map:Record<string,string>|undefined;if(typeof p.sheetMapJson==="string")map=JSON.parse(p.sheetMapJson);return agent.scan({query:typeof p.query==="string"?p.query:undefined,limit:typeof p.limit==="number"?p.limit:undefined,sheetMap:map,provider:p.provider==="yahoo"?"yahoo":"google"});}});
}
