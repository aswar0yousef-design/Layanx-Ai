import assert from "node:assert/strict";
import http from "node:http";
import {fillWebForm,parseFormMapping,webFormRequest,formPrompt} from "../src/tools/web-form.js";

// Seen live 2026-11-12: the agent used LayanX's internal shipping tool for "get a quote on this site" and Yahoo Mail for
// "send a message through the contact page". A named site plus a form verb now goes to web.form.
assert.equal(webFormRequest("افتح الموقع http://x.example/ واطلب عرض سعر شحن من صنعاء إلى عدن"),"http://x.example/");
assert.equal(webFormRequest("افتح https://youtube.com"),null,"just opening a site is not a form task");
assert.equal(webFormRequest("اطلب عرض سعر شحن"),null,"no site named");

const forms=[{index:0,fields:[{key:"from",label:"من",type:"text"},{key:"weight",label:"الوزن",type:"number"}],buttons:["احسب السعر"]}];
const mapped=parseFormMapping({form:0,values:{from:"صنعاء",weight:"3",invented:"x"},submit:"احسب السعر"},forms);
assert.deepEqual(mapped.values,{from:"صنعاء",weight:"3"},"only real fields are filled");
assert.match(formPrompt("x",forms),/untrusted page text/);

// The site address and invented values never go into a field (seen live: "from" got the URL), and the reply is written by code.
{
  const {requestData}=await import("../src/tools/web-form.js");
  const data=requestData("افتح الموقع http://127.0.0.1:5/ واطلب عرض سعر شحن من صنعاء إلى عدن بوزن 3 كيلو");
  assert.ok(!data.includes("http")&&data.includes("صنعاء"),data);
  const quote=[{index:0,fields:[{key:"from",label:"من",type:"text"},{key:"to",label:"إلى",type:"text"},{key:"weight",label:"الوزن",type:"number"}],buttons:["احسب"]}];
  const bad=parseFormMapping({form:0,values:{from:"http://127.0.0.1:5/",to:"عدن",weight:"3"}},quote,data);
  assert.deepEqual(bad.dropped,["from"]);
  assert.deepEqual(bad.values,{to:"عدن",weight:"3"});
  const {webFormReply}=await import("../src/core/task-answer.js");
  assert.match(webFormReply({url:"http://s/",submitted:true,filled:{"من":"صنعاء"},resultText:"السعر: 3000 ريال"},true)!,/ردّ الموقع:\nالسعر: 3000 ريال/);
  assert.match(webFormReply({url:"http://s/",submitted:false,note:"Not submitted: from"},true)!,/لم أرسل النموذج/);
}
{
  const {fromRequest}=await import("../src/tools/web-form.js");
  assert.ok(fromRequest("متى يصل طلبي رقم 4471","أرسل رسالة باسم سالم نصها: متى يصل طلبي رقم 4471؟"),"punctuation does not matter");
  assert.ok(fromRequest("سالم","باسم سالم"));
  assert.ok(!fromRequest("http://127.0.0.1:5/","من صنعاء إلى عدن"));
  assert.ok(!fromRequest("أحمد","باسم سالم"));
}
let pw:any;try{pw=await import("playwright-core");}catch{pw=null;}
if(!pw){console.log("web-form: playwright-core missing; the browser part was skipped");process.exit(0);}
const received:Record<string,string>[]=[];
const site=http.createServer(async(req,res)=>{let b="";for await(const c of req)b+=c;res.writeHead(200,{"content-type":"text/html; charset=utf-8"});
  if(req.method==="POST"){const f=Object.fromEntries(new URLSearchParams(b));received.push(f);return res.end(`<p>السعر: ${1500+Number(f.weight)*500} ريال</p>`);}
  res.end(`<!doctype html><meta charset="utf-8"><form method="post" action="/quote"><label for="from">من</label><input id="from" name="from"><label for="to">إلى</label><input id="to" name="to"><label for="weight">الوزن (كغ)</label><input id="weight" name="weight" type="number"><button type="submit">احسب السعر</button></form>`);});
await new Promise<void>(r=>site.listen(0,"127.0.0.1",()=>r()));
const url="http://127.0.0.1:"+(site.address() as {port:number}).port+"/";
const prompts:string[]=[];
try{
  const result=await fillWebForm({url,goal:"اطلب عرض سعر شحن من صنعاء إلى عدن بوزن 3 كيلو"},{think:async p=>{prompts.push(p);return JSON.stringify({form:0,values:{from:"صنعاء",to:"عدن",weight:"3"},submit:"احسب السعر"});}});
  assert.match(prompts[0]!,/"label":"الوزن \(كغ\)"/,"the model sees the fields by their labels");
  assert.deepEqual(received[0],{from:"صنعاء",to:"عدن",weight:"3"},"the site really received the form");
  assert.equal(result.submitted,true);
  assert.match(result.resultText!,/السعر: 3000 ريال/,"the site's answer is returned as evidence");
  assert.deepEqual(result.filled,{"من":"صنعاء","إلى":"عدن","الوزن (كغ)":"3"});
}finally{site.close();}
console.log("web-form: the form is filled by its labels in LayanX's own browser, really submitted, and the site's answer returned");
process.exit(0);
