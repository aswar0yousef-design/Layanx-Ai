/**
 * Builds the invoice PDFs the tests read (run once; the files are committed): two text PDFs made by Chromium, the way many
 * billing systems make them (an English one, an Arabic one with an embedded Arabic font), and a "scanned" one that is only a
 * picture of an invoice, with no text layer at all.
 *   npx tsx tests/fixtures/make-invoice-pdfs.ts
 */
import fs from "node:fs";
import path from "node:path";
import {sharedBrowser} from "../../src/autonomy/browser-test.js";

const dir=path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,"$1")),"pdf");
fs.mkdirSync(dir,{recursive:true});
const page=(body:string,rtl=false)=>`<!doctype html><html${rtl?' lang="ar" dir="rtl"':""}><meta charset="utf-8"><style>body{font-family:${rtl?"Tahoma,Arial":"Arial"};margin:40px;font-size:15px}td{padding:6px 12px;border-bottom:1px solid #ccc}h1{font-size:24px}</style><body>${body}</body></html>`;
const DHL=page(`<h1>DHL Express</h1><p>Commercial Invoice</p><table>
<tr><td>Invoice Number</td><td>DHL-2026-88417</td></tr><tr><td>Invoice Date</td><td>2026-11-12</td></tr><tr><td>Waybill</td><td>7723019456</td></tr>
<tr><td>Freight charges</td><td>SAR 400.00</td></tr><tr><td>VAT 15%</td><td>SAR 60.00</td></tr><tr><td><b>Total Amount Due</b></td><td><b>SAR 460.00</b></td></tr></table>`);
const ARAMEX=page(`<h1>أرامكس</h1><p>فاتورة ضريبية</p><table>
<tr><td>رقم الفاتورة</td><td>ARX-90012</td></tr><tr><td>التاريخ</td><td>2026-11-11</td></tr><tr><td>رقم الشحنة</td><td>55120098</td></tr>
<tr><td>الإجمالي المستحق</td><td>275.50 ريال</td></tr></table>`,true);
const SMSA=page(`<h1>SMSA Express</h1><p>Tax Invoice</p><table>
<tr><td>Invoice No</td><td>SM-30566</td></tr><tr><td>Date</td><td>2026-11-09</td></tr><tr><td>AWB</td><td>290044781</td></tr>
<tr><td><b>Grand Total</b></td><td><b>SAR 1,830.25</b></td></tr></table>`);

const browser=await sharedBrowser();
const context=await browser.newContext({viewport:{width:900,height:700}});
try{
  const p=await context.newPage();
  for(const [name,html] of [["dhl-invoice.pdf",DHL],["aramex-invoice.pdf",ARAMEX]] as const){
    await p.setContent(html,{waitUntil:"load"});await p.pdf({path:path.join(dir,name),format:"A4",printBackground:true});
  }
  // The scanned one: a screenshot of the invoice, placed in a PDF as an image only.
  await p.setContent(SMSA,{waitUntil:"load"});
  const png=(await p.screenshot({fullPage:false})).toString("base64");
  await p.setContent(`<!doctype html><html><body style="margin:0"><img src="data:image/png;base64,${png}" style="width:100%"></body></html>`,{waitUntil:"load"});
  await p.pdf({path:path.join(dir,"smsa-scanned.pdf"),format:"A4"});
}finally{await context.close();}
for(const f of fs.readdirSync(dir))console.log(f,fs.statSync(path.join(dir,f)).size);
process.exit(0);
