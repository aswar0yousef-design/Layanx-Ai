import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const src=fs.readFileSync(path.resolve("web","app.js"),"utf8");
new Function(src); // reject broken Control Center JavaScript before browser loading
const start=src.indexOf("function greetingOnly(text){");
const end=src.indexOf("async function runGoal(goal,model){",start);
assert.ok(start>=0&&end>start,"Control Center has a greeting-only fast path");
const greetingOnly=new Function(src.slice(start,end)+"; return greetingOnly;")() as (text:string)=>boolean;
for(const phrase of ["مرحبا كيف الحال","كيف الحال؟","مرحبا","أهلا","صباح الخير","السلام عليكم","Hello","how are you","Hi"]){
 assert.equal(greetingOnly(phrase),true,"Greeting must be conversational: "+phrase);
}
for(const phrase of ["مرحبا افتح المتصفح","كيف الحال في الأسواق المالية؟","hello, write a post",
 "افتح ملفاتي","list files","صحح أخطاء المشروع","مرحبا ارسل رسالة","تحقق من حالة الجهاز"]){
 assert.equal(greetingOnly(phrase),false,"Action must not be swallowed as greeting: "+phrase);
}
const handler=src.slice(end,src.indexOf("function messageView(m){",end));
assert.ok(handler.indexOf('if(greetingOnly(goal))')>=0);
assert.ok(handler.indexOf('"/v1/assistant/turn"')<handler.indexOf('"/v1/agent/gateway"'));
assert.match(handler,/allowTasks:false/,"Greeting calls should never execute external actions");
assert.match(handler,/me\.text=me\.state==="done"\?answer\.reply/,"Show the assistant's actual answer, not a fake completed mission");

let pw:any;try{pw=await import("playwright-core");}catch{pw=null;}
const chromium=pw?.chromium??pw?.default?.chromium;
let browser:any=null;
if(chromium)for(const option of [...(process.env.LAYANX_BROWSER_PATH?[{executablePath:process.env.LAYANX_BROWSER_PATH}]:[]),
 {channel:"msedge"},{channel:"chrome"}]){try{browser=await chromium.launch({headless:true,...option});break;}catch{}}
if(!browser){console.log("control-center greeting routing: static checks passed (browser unavailable)");process.exit(0);}

let assistantCalls=0,gatewayCalls=0,supervisorPosts=0,lastAssistant:Record<string,unknown>|null=null;
const publicFiles=path.resolve("web");
const server=http.createServer(async(req,res)=>{
 const url=(req.url??"/").split("?")[0]!;
 const send=(obj:unknown,code=200)=>{res.writeHead(code,{"content-type":"application/json"});res.end(JSON.stringify(obj));};
 if(["/","/index.html","/app.js","/styles.css"].includes(url)){
  const f=path.join(publicFiles,url==="/"?"index.html":url.slice(1));
  res.writeHead(200,{"content-type":url.endsWith(".js")?"text/javascript":url.endsWith(".css")?"text/css":"text/html; charset=utf-8"});
  res.end(fs.readFileSync(f));return;
 }
 if(url==="/v1/assistant/turn"){
  assistantCalls++;
  let body="";for await (const c of req)body+=String(c);
  lastAssistant=JSON.parse(body) as Record<string,unknown>;
  return send({ok:true,intent:"answer",reply:"بخير والحمد لله، كيف أقدر أساعدك؟"});
 }
 if(url==="/v1/agent/gateway"){
  gatewayCalls++;
  return send({ok:false,completed:false,status:"failed",reason:"mock no external execution"});
 }
 if(url==="/v1/setup/status")return send({owner:{name:"Owner"},workspace:{root:"C:\\Users\\Test\\LayanX-Projects",projects:["default"],linked:[]},capabilities:{},secrets:{names:[]}});
 if(url==="/v1/supervisor/jobs"){if(req.method==="POST"){supervisorPosts++;return send({ok:true,job:{id:"unexpected-job",projectId:"default",status:"running"}});}return send({ok:true,jobs:[]});}
 if(url==="/v1/missions")return send({ok:true,missions:[]});
 if(url==="/v1/approvals")return send({ok:true,approvals:[]});
 return send({ok:true});
});
await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
const address=server.address();assert.ok(address&&typeof address!=="string");
const page=await browser.newPage();
try{
 await page.goto("http://127.0.0.1:"+address.port+"/#agent",{waitUntil:"domcontentloaded"});
 await page.locator("#agentInput").waitFor({timeout:15000});
 const autonomy=page.locator("button[aria-pressed]").first();
 await autonomy.waitFor({timeout:10000});
 if(await autonomy.getAttribute("aria-pressed")!=="true")await autonomy.click();
 assert.equal(await autonomy.getAttribute("aria-pressed"),"true","Autonomous mode is enabled for the regression");
 await page.locator("#agentInput").fill("مرحبا كيف الحال");
 await page.locator("#agentInput").press("Enter");
 await page.waitForFunction(()=>document.querySelector("#chat")?.textContent?.includes("بخير والحمد لله"),{timeout:15000});
 assert.equal(assistantCalls,1,"One assistant turn for pure greeting");
 assert.equal(gatewayCalls,0,"A greeting must not create an agent mission");
 assert.equal(supervisorPosts,0,"Greeting must not create an autonomous Supervisor job when Auto mode is enabled");
 assert.equal(lastAssistant?.allowTasks,false);
 await autonomy.click();
 assert.equal(await autonomy.getAttribute("aria-pressed"),"false");
 await page.locator("#agentInput").fill("مرحبا افتح المتصفح");
 await page.locator("#agentInput").press("Enter");
 const deadline=Date.now()+10000;while(gatewayCalls===0&&Date.now()<deadline)await new Promise(r=>setTimeout(r,40));
 assert.equal(gatewayCalls,1,"A mixed greeting and instruction goes to the permission-gated gateway");
 assert.equal(assistantCalls,1,"Mixed request not swallowed by conversational route");
 console.log("control-center greeting routing: real browser, autonomous greeting no supervisor task, correct reply and mixed action gated");
}finally{
 await page.close();await browser.close();
 await new Promise<void>(resolve=>server.close(()=>resolve()));
}
process.exit(0);
