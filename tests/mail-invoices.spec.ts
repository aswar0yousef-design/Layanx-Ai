import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {amountIn,checkInvoice,gmailText,mailInvoiceRequest,mimeText} from "../src/business/mail-invoices.js";
import {createGoogleWorkspaceAdapter} from "../src/connectors/google-workspace.js";
import {GoogleInvoiceAgent} from "../src/google-invoice-agent.js";
import {mailInvoiceReply} from "../src/core/task-answer.js";
import {SAMPLE_MAILS,startFakeGoogle} from "./fixtures/fake-google.js";

// Decoding: the model reads the email, not Gmail's base64 or Yahoo's MIME source (found 2026-11-13).
{
  const b=(s:string)=>Buffer.from(s).toString("base64").replace(/\+/g,"-").replace(/\//g,"_");
  const t=gmailText({payload:{headers:[{name:"From",value:"A <a@x.com>"},{name:"Subject",value:"S"}],parts:[{mimeType:"text/html",body:{data:b("<p>فاتورة رقم <b>X-1</b></p>")}}]}});
  assert.match(t.text,/فاتورة رقم X-1/);
  const mime=["From: =?UTF-8?B?"+Buffer.from("أرامكس").toString("base64")+"?= <i@aramex.com>","Subject: =?UTF-8?Q?=D9=81=D8=A7=D8=AA=D9=88=D8=B1=D8=A9?=","Content-Type: multipart/mixed; boundary=\"b1\"","","--b1","Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: quoted-printable","","=D8=A7=D9=84=D8=A5=D8=AC=D9=85=D8=A7=D9=84=D9=8A 345.00","--b1","Content-Type: application/pdf; name=\"inv.pdf\"","Content-Disposition: attachment; filename=\"inv.pdf\"","Content-Transfer-Encoding: base64","","JVBERi0=","--b1--",""].join("\r\n");
  const y=mimeText(mime);
  assert.equal(y.from,"أرامكس <i@aramex.com>");assert.equal(y.subject,"فاتورة");assert.match(y.text,/الإجمالي 345.00/);assert.deepEqual(y.attachments.map(a=>a.filename),["inv.pdf"]);
}
// Every value must be in the email: a guessed number is never written.
assert.equal(amountIn("1250.50","Total due: SAR 1,250.50"),"1250.50");
assert.equal(amountIn("345","الإجمالي المستحق ٣٤٥٫٠٠ ريال"),"345.00","Arabic digits and decimal mark");
assert.equal(amountIn("1300","Total due: SAR 1,250.50"),null);
const mail={from:"DHL <noreply@dhl.com>",subject:"Invoice available",date:"",text:"Your DHL invoice is attached as a PDF.",attachments:[{filename:"x.pdf",mimeType:"application/pdf"}]};
assert.deepEqual(checkInvoice({isInvoice:true,company:"DHL",invoiceNumber:"DHL-2026-001",amount:"480"},mail).problems,['invoice number "DHL-2026-001" is not in the email','amount "480" is not in the email'],"a model filling the blanks is caught");
assert.ok(mailInvoiceRequest("اقرأ فواتير الشحن من بريدي وسجلها في Sheets"));
assert.deepEqual(mailInvoiceRequest("سجل فواتير ياهو في جوجل شيت"),{provider:"yahoo"});
assert.equal(mailInvoiceRequest("كيف أسجل الفواتير من الإيميل؟"),null,"a question stays a conversation");
assert.equal(mailInvoiceRequest("اطبع فاتورة الطلب 1041"),null,"a store invoice is the shipping desk's");

// The whole scan against stand-in Gmail, Drive and Sheets.
const google=await startFakeGoogle(SAMPLE_MAILS);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"mail-inv-"));
try{
  // A careful extractor: what a good model returns for each sample (the DHL one fills blanks, to prove the check).
  const answers:Record<string,unknown>={
    "Your invoice INV-55821":{isInvoice:true,company:"SMSA Express",invoiceNumber:"INV-55821",date:"2026-11-10",amount:"1250.50",currency:"SAR",shipmentNumber:"290011223"},
    "فاتورة شحن رقم ARX-7731":{isInvoice:true,company:"أرامكس",invoiceNumber:"ARX-7731",amount:"345.00",currency:"ريال",shipmentNumber:"44552211"},
    "5 ways to grow your store this winter":{isInvoice:false},
    "Invoice available":{isInvoice:true,company:"DHL",invoiceNumber:"DHL-2026-001",amount:"480"},
    "Reminder: invoice INV-55821":{isInvoice:true,company:"SMSA Express",invoiceNumber:"INV-55821",amount:"1250.50",currency:"SAR"}};
  const think=async(prompt:string)=>{const subject=/Subject: (.*)/.exec(prompt)![1]!;return JSON.stringify(answers[subject]);};
  const agent=new GoogleInvoiceAgent({} as any,{google:createGoogleWorkspaceAdapter({accessToken:"google_test_token",fetcher:google.fetcher}),registryPath:path.join(dir,"registry.json"),think});
  const report=await agent.scan({provider:"google"});
  assert.deepEqual(report.written.map(w=>[w.company,w.invoiceNumber,w.amount]),[["SMSA Express","INV-55821","1250.50"],["أرامكس","ARX-7731","345.00"]]);
  assert.deepEqual(report.duplicates.map(d=>d.invoiceNumber),["INV-55821"],"the reminder is the same invoice");
  assert.equal(report.notInvoices,1);
  assert.equal(report.skipped.length,1);assert.match(report.skipped[0]!.reason,/not in the email/);
  assert.deepEqual(report.errors,[]);
  // What Google holds: one sheet per company, created with its Invoices tab, header then the row.
  const books=[...google.sheets.values()];
  assert.deepEqual(books.map(b=>b.title).sort(),["SMSA Express - Invoices","أرامكس - Invoices"].sort());
  const smsa=books.find(b=>b.title.startsWith("SMSA"))!.tabs.get("Invoices")!;
  assert.equal(smsa[0]![0],"Invoice Number");assert.deepEqual(smsa.slice(1).map(r=>[r[0],r[2],r[5]]),[["INV-55821","1250.50","290011223"]]);
  assert.deepEqual(google.folders.map(f=>f.name).slice(0,2),["LayanX Business","Shipping Companies"]);
  // Running again writes nothing new.
  const again=await agent.scan({provider:"google"});
  assert.equal(again.written.length,0);assert.equal(again.duplicates.length,3);
  // The registry lost: the sheet itself still stops a duplicate.
  fs.rmSync(path.join(dir,"registry.json"));
  const fresh=new GoogleInvoiceAgent({} as any,{google:createGoogleWorkspaceAdapter({accessToken:"google_test_token",fetcher:google.fetcher}),registryPath:path.join(dir,"registry.json"),think});
  await fresh.scan({provider:"google"});
  assert.equal(books.find(b=>b.title.startsWith("SMSA"))!.tabs.get("Invoices")!.length,2,"still header + one row");
  const text=mailInvoiceReply(report,true)!;
  assert.match(text,/سجّلتُ 2 فاتورة جديدة/);assert.match(text,/أرامكس: ARX-7731 — 345.00 ريال/);assert.match(text,/Invoice available: رقم الفاتورة «DHL-2026-001» ليس في الرسالة/);
}finally{await google.close();}
{
  const {routeRequest}=await import("../src/voice/request-router.js");
  assert.equal(routeRequest("اقرأ فواتير الشحن من بريدي وسجلها في Sheets").route,"task");
  const {AiMissionPlanner}=await import("../src/core/ai-planner.js");
  const plan=await new AiMissionPlanner({execute:async()=>{throw new Error("no model");}} as any).plan("اقرأ فواتير الشحن من بريدي وسجلها في Sheets",[{name:"email.invoices.scan",description:"",permission:"L3_MODIFY",dangerous:false,actions:["scan invoices"],tags:[]}] as any);
  assert.deepEqual(plan.tools.map(t=>[t.tool,t.payload]),[["email.invoices.scan",{provider:"google",limit:20}]]);
}
console.log("mail-invoices: emails decoded, every value checked against the email, one sheet per company, never twice");
{
  // Seen live: a value not in the email gets one more, specific question; the check stays strict.
  const {readInvoice}=await import("../src/business/mail-invoices.js");
  const prompts:string[]=[];
  const m={from:"SMSA <b@smsa.com>",subject:"Invoice INV-1",date:"",text:"SMSA Express Invoice No: INV-1 Total due: SAR 1,250.50",attachments:[]};
  const r=await readInvoice(m,async p=>{prompts.push(p);return JSON.stringify({isInvoice:true,company:"SMSA Express",invoiceNumber:"INV-1",amount:prompts.length===1?"125050":"1,250.50"});});
  assert.equal(r.invoice?.amount,"1250.50");assert.match(prompts[1]!,/amount "125050" is not in the email/);
  const never=await readInvoice(m,async()=>JSON.stringify({isInvoice:true,company:"SMSA Express",invoiceNumber:"INV-1",amount:"999"}));
  assert.equal(never.invoice,undefined,"still refused after the second answer");
  console.log("mail-invoices: a value not in the email is asked again once, never accepted");
}
