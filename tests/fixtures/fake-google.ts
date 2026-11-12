import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const PDF_DIR=path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/,"$1")),"pdf");
const pdfBytes=(name:string)=>{try{return fs.readFileSync(path.join(PDF_DIR,name));}catch{return Buffer.from("not a pdf");}};

/**
 * A stand-in for Gmail, Drive and Sheets where LayanX depends on them. Gmail returns messages in format=full with base64url
 * bodies (as the real API does); a new spreadsheet's only sheet is "Sheet1" unless the request names its sheets, and writing to
 * a sheet that does not exist is refused with 400 "Unable to parse range" (as Google does).
 */
export interface FakeMail{id:string;from:string;subject:string;date:string;plain?:string;html?:string;attachments?:string[]}
export interface FakeGoogle{url:string;sheets:Map<string,{title:string;tabs:Map<string,string[][]>}>;folders:Array<{id:string;name:string;parent?:string}>;requests:Array<{method:string;path:string}>;fetcher:typeof fetch;close():Promise<void>}
const b64url=(s:string)=>Buffer.from(s,"utf8").toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");

export async function startFakeGoogle(mails:FakeMail[],token="google_test_token"):Promise<FakeGoogle>{
  const sheets:FakeGoogle["sheets"]=new Map(),folders:FakeGoogle["folders"]=[],requests:FakeGoogle["requests"]=[];
  let n=0;
  const server=http.createServer(async(req,res)=>{
    let raw="";for await(const c of req)raw+=c;
    const u=new URL(req.url??"/","http://x");
    requests.push({method:req.method??"GET",path:u.pathname+u.search});
    const send=(s:number,d:unknown)=>{res.writeHead(s,{"content-type":"application/json"});res.end(JSON.stringify(d));};
    if(req.headers.authorization!=="Bearer "+token)return send(401,{error:{code:401,message:"Request had invalid authentication credentials."}});
    const p=decodeURIComponent(u.pathname);
    let m:RegExpExecArray|null;
    if(req.method==="GET"&&p==="/gmail/v1/users/me/messages")return send(200,{messages:mails.slice(0,Number(u.searchParams.get("maxResults")??20)).map(x=>({id:x.id,threadId:x.id}))});
    if(req.method==="GET"&&(m=/^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/attachments\/att-(.+)$/.exec(p))){
      const mail=mails.find(x=>x.id===m![1]);if(!mail||!(mail.attachments??[]).includes(m[2]!))return send(404,{error:{code:404,message:"Not Found"}});
      const bytes=pdfBytes(m[2]!);return send(200,{size:bytes.length,data:bytes.toString("base64").replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")});
    }
    if(req.method==="GET"&&(m=/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(p))){
      const mail=mails.find(x=>x.id===m![1]);if(!mail)return send(404,{error:{code:404,message:"Not Found"}});
      const parts:any[]=[];
      if(mail.plain!==undefined)parts.push({mimeType:"text/plain",body:{data:b64url(mail.plain)}});
      if(mail.html!==undefined)parts.push({mimeType:"text/html",body:{data:b64url(mail.html)}});
      for(const a of mail.attachments??[])parts.push({mimeType:"application/pdf",filename:a,body:{attachmentId:"att-"+a,size:pdfBytes(a).length}});
      return send(200,{id:mail.id,snippet:"",payload:{mimeType:"multipart/mixed",headers:[{name:"From",value:mail.from},{name:"Subject",value:mail.subject},{name:"Date",value:mail.date}],parts:[{mimeType:"multipart/alternative",parts:parts.filter(x=>!x.filename)},...parts.filter(x=>x.filename)]}});
    }
    if(req.method==="GET"&&p==="/drive/v3/files"){
      const q=u.searchParams.get("q")??"";const name=/name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g,"'");const parent=/'([^']+)' in parents/.exec(q)?.[1];
      return send(200,{files:folders.filter(f=>f.name===name&&(!parent||f.parent===parent)).map(f=>({id:f.id,name:f.name}))});
    }
    if(req.method==="POST"&&p==="/drive/v3/files"){const b=JSON.parse(raw);const f={id:"folder"+(++n),name:b.name,...(b.parents?.[0]?{parent:b.parents[0]}:{})};folders.push(f);return send(200,{id:f.id,name:f.name});}
    if(req.method==="PATCH"&&(m=/^\/drive\/v3\/files\/([^/]+)$/.exec(p)))return send(200,{id:m[1],parents:[u.searchParams.get("addParents")]});
    if(req.method==="POST"&&p==="/v4/spreadsheets"){
      const b=JSON.parse(raw);const id="sheet"+(++n);
      const tabs=new Map<string,string[][]>();for(const s of b.sheets?.length?b.sheets:[{properties:{title:"Sheet1"}}])tabs.set(s.properties.title,[]);
      sheets.set(id,{title:b.properties?.title??"",tabs});return send(200,{spreadsheetId:id,properties:b.properties,sheets:[...tabs.keys()].map(title=>({properties:{title}}))});
    }
    if((m=/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+?)(:append)?$/.exec(p))){
      const book=sheets.get(m[1]!);if(!book)return send(404,{error:{code:404,message:"Requested entity was not found."}});
      const tab=m[2]!.split("!")[0]!;const rows=book.tabs.get(tab);
      if(!rows)return send(400,{error:{code:400,message:"Unable to parse range: "+m[2]}});
      if(m[3]&&req.method==="POST"){const values=JSON.parse(raw).values as string[][];rows.push(...values.map(r=>r.map(String)));return send(200,{updates:{updatedRange:m[2],updatedRows:values.length}});}
      if(req.method==="GET")return send(200,{range:m[2],values:rows.map(r=>[r[0]??""])});
    }
    send(404,{error:{code:404,message:"Not found: "+p}});
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
  const url="http://127.0.0.1:"+(server.address() as {port:number}).port;
  // Google's real host is swapped for this server in the test's own fetcher only.
  const fetcher=((input:any,init?:any)=>fetch(String(input).replace("https://www.googleapis.com",url),init)) as typeof fetch;
  return{url,sheets,folders,requests,fetcher,close:()=>new Promise(r=>server.close(()=>r()))};
}

/** Realistic mail: an English carrier invoice, an Arabic one in HTML only, a newsletter, a PDF-only invoice, and a resent duplicate. */
export const SAMPLE_MAILS:FakeMail[]=[
  {id:"m1",from:"SMSA Express <billing@smsaexpress.com>",subject:"Your invoice INV-55821",date:"Mon, 10 Nov 2026 09:12:00 +0300",
   plain:"Dear customer,\n\nSMSA Express\nInvoice No: INV-55821\nInvoice date: 2026-11-10\nAWB: 290011223\nShipping charges: SAR 1,100.00\nVAT 15%: SAR 150.50\nTotal due: SAR 1,250.50\n\nThank you for shipping with SMSA."},
  {id:"m2",from:"أرامكس <invoices@aramex.com>",subject:"فاتورة شحن رقم ARX-7731",date:"Tue, 11 Nov 2026 14:00:00 +0300",
   html:"<html><body><h2>أرامكس</h2><p>عميلنا العزيز، مرفق تفاصيل فاتورتكم.</p><table><tr><td>رقم الفاتورة</td><td>ARX-7731</td></tr><tr><td>رقم الشحنة</td><td>44552211</td></tr><tr><td>الإجمالي المستحق</td><td>٣٤٥٫٠٠ ريال</td></tr></table></body></html>"},
  {id:"m3",from:"Store Tips <news@shopify-tips.example>",subject:"5 ways to grow your store this winter",date:"Wed, 12 Nov 2026 08:00:00 +0300",
   plain:"Grow your sales this winter with these 5 ideas. 1) Offer free shipping over 200. 2) Bundle products. Unsubscribe anytime."},
  {id:"m4",from:"DHL Billing <noreply@dhl.com>",subject:"Invoice available",date:"Wed, 12 Nov 2026 10:00:00 +0300",
   plain:"Hello,\n\nYour DHL invoice is attached as a PDF. Please pay by the due date.\n\nDHL Express",attachments:["dhl-invoice.pdf"]},
  {id:"m6",from:"أرامكس <billing@aramex.com>",subject:"فاتورتكم الضريبية",date:"Wed, 12 Nov 2026 12:00:00 +0300",
   plain:"عميلنا العزيز، تجدون فاتورتكم الضريبية في المرفق.\nأرامكس",attachments:["aramex-invoice.pdf"]},
  {id:"m7",from:"SMSA Express <billing@smsaexpress.com>",subject:"Scanned invoice",date:"Wed, 12 Nov 2026 13:00:00 +0300",
   plain:"Please find the scanned invoice attached.",attachments:["smsa-scanned.pdf"]},
  {id:"m5",from:"SMSA Express <billing@smsaexpress.com>",subject:"Reminder: invoice INV-55821",date:"Thu, 13 Nov 2026 09:12:00 +0300",
   plain:"Reminder from SMSA Express.\nInvoice No: INV-55821\nTotal due: SAR 1,250.50\nPlease pay before 2026-11-20."}
];
