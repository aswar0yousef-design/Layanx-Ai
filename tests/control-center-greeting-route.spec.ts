import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const src=fs.readFileSync(path.resolve("web","app.js"),"utf8");
new Function(src); // reject broken Control Center JavaScript before browser loading
const start=src.indexOf("function greetingOnly(text){");
const end=src.indexOf("async function classifyTurn(goal){",start);
assert.ok(start>=0&&end>start,"Control Center has a greeting-only fast path");
const classifiers=new Function(src.slice(start,end)+"; return {greetingOnly,capabilityQuestionOnly,conversationOnly};")() as {greetingOnly:(text:string)=>boolean;capabilityQuestionOnly:(text:string)=>boolean;conversationOnly:(text:string)=>boolean};
const {greetingOnly,capabilityQuestionOnly,conversationOnly}=classifiers;
for(const phrase of ["مرحبا كيف الحال","كيف الحال؟","مرحبا","أهلا","صباح الخير","السلام عليكم","Hello","how are you","Hi"]){
 assert.equal(greetingOnly(phrase),true,"Greeting must be conversational: "+phrase);
}
for(const phrase of ["مرحبا افتح المتصفح","كيف الحال في الأسواق المالية؟","hello, write a post",
 "افتح ملفاتي","list files","صحح أخطاء المشروع","مرحبا ارسل رسالة","تحقق من حالة الجهاز"]){
 assert.equal(greetingOnly(phrase),false,"Action must not be swallowed as greeting: "+phrase);
}
for(const phrase of ["مالذي يمكنك عمله","ما الذي يمكنك عمله؟","ما الذي يمكنك فعله","ماذا يمكنك عمله لي","ما هي إمكانياتك","what can you do?"]){
 assert.equal(capabilityQuestionOnly(phrase),true,"Capabilities must be conversation: "+phrase);
 assert.equal(conversationOnly(phrase),true);
}
for(const phrase of ["ما الذي يمكنك عمله في مشروعي؟","ماذا يمكنك عمله لتطوير المتجر","what can you do with this CSV file?","افتح المتصفح"]){
 assert.equal(capabilityQuestionOnly(phrase),false,"Specific action must remain gated: "+phrase);
}
const handler=src.slice(end,src.indexOf("function messageView(m){",end));
assert.ok(handler.indexOf('route==="conversation"')>=0,"Shared brain must explicitly route conversations");
assert.match(handler,/const route=knownKind\|\|/,"Direct commands must also go through the dialogue brain");
assert.match(src,/if\(conversationOnly\(g\)\)\{runGoal\(g,model.value\);return;\}/,"Pure information must bypass autonomous jobs");
assert.ok(handler.indexOf('"/v1/assistant/turn"')<handler.indexOf('"/v1/agent/gateway"'));
assert.match(handler,/allowTasks:false/,"Greeting calls should never execute external actions");
assert.match(handler,/me\.text=informational\?answer\.reply/,"Show the actual informative answer, never a fake completion");

let pw:any;try{pw=await import("playwright-core");}catch{pw=null;}
const chromium=pw?.chromium??pw?.default?.chromium;
let browser:any=null;
if(chromium)for(const option of [...(process.env.LAYANX_BROWSER_PATH?[{executablePath:process.env.LAYANX_BROWSER_PATH}]:[]),
 {channel:"msedge"},{channel:"chrome"}]){try{browser=await chromium.launch({headless:true,...option});break;}catch{}}
if(!browser){console.log("control-center greeting routing: static checks passed (browser unavailable)");process.exit(0);}

let assistantCalls=0,gatewayCalls=0,supervisorPosts=0,brainCalls=0,lastAssistant:Record<string,unknown>|null=null;
const publicFiles=path.resolve("web");
const server=http.createServer(async(req,res)=>{
 const url=(req.url??"/").split("?")[0]!;
 const send=(obj:unknown,code=200)=>{res.writeHead(code,{"content-type":"application/json"});res.end(JSON.stringify(obj));};
 if(["/","/index.html","/app.js","/styles.css"].includes(url)){
  const f=path.join(publicFiles,url==="/"?"index.html":url.slice(1));
  res.writeHead(200,{"content-type":url.endsWith(".js")?"text/javascript":url.endsWith(".css")?"text/css":"text/html; charset=utf-8"});
  res.end(fs.readFileSync(f));return;
 }
 if(url==="/v1/assistant/classify"){
  brainCalls++;
  let input="";for await(const chunk of req)input+=String(chunk);
  const text=String((JSON.parse(input) as {text?:string}).text||"");
  const question=/^(?:من\s|هل\s|كيف\s|ما\s|ماذا\s|who\s|what\s|can\s|how\s)/i.test(text);
  return send({ok:true,kind:question?"conversation":"action",topic:question?"question":"instruction"});
 }
 if(url==="/v1/assistant/turn"){
  assistantCalls++;
  let body="";for await (const c of req)body+=String(c);
  lastAssistant=JSON.parse(body) as Record<string,unknown>;
  const text=String(lastAssistant?.text||"");
  const reply=text.includes("عمله")?"أستطيع مساعدتك في الملفات والبرمجة والاختبارات ضمن الصلاحيات.":text.includes("من أنت")?"أنا LayanX، مساعد ذكاء اصطناعي على جهازك.":text.includes("هل تتعلم")?"يمكنني مراجعة الكود واختباره بموافقتك، لكن لا أطور النموذج تلقائيًا.":"بخير والحمد لله، كيف أقدر أساعدك؟";
  return send({ok:true,intent:"answer",reply});
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
 await page.locator("#agentInput").fill("مالذي يمكنك عمله");
 await page.locator("#agentInput").press("Enter");
 await page.waitForFunction(()=>document.querySelector("#chat")?.textContent?.includes("أستطيع مساعدتك في الملفات"),{timeout:15000});
 assert.equal(assistantCalls,2,"Capabilities must use assistant even with Auto mode on");
 assert.equal(gatewayCalls,0);
 assert.equal(supervisorPosts,0,"Capabilities must not create autonomous Supervisor jobs");
 await page.locator("#agentInput").fill("من أنت؟");
 await page.locator("#agentInput").press("Enter");
 await page.waitForFunction(()=>document.querySelector("#chat")?.textContent?.includes("أنا LayanX"),{timeout:15000});
 assert.equal(assistantCalls,3,"Identity must be conversational, even with Auto on");
 assert.equal(gatewayCalls,0);assert.equal(supervisorPosts,0);
 await page.locator("#agentInput").fill("هل تتعلم وتطور من نفسك؟");
 await page.locator("#agentInput").press("Enter");
 await page.waitForFunction(()=>document.querySelector("#chat")?.textContent?.includes("مراجعة الكود"),{timeout:15000});
 assert.equal(assistantCalls,4,"Self-development must not trigger a mission");
 assert.equal(gatewayCalls,0);assert.equal(supervisorPosts,0);
 assert.ok(brainCalls>=2,"The server-side dialogue brain classified informational questions");
 await autonomy.click();
 assert.equal(await autonomy.getAttribute("aria-pressed"),"false");
 await page.locator("#agentInput").fill("ما الذي يمكنك عمله؟");
 await page.locator("#agentInput").press("Enter");
 const until=Date.now()+15000;while(assistantCalls<3&&Date.now()<until)await new Promise(r=>setTimeout(r,40));
 assert.equal(assistantCalls,5,"Capability question still conversational with Auto off");
 assert.equal(gatewayCalls,0);
 await page.locator("#agentInput").fill("مرحبا افتح المتصفح");
 await page.locator("#agentInput").press("Enter");
 const deadline=Date.now()+10000;while(gatewayCalls===0&&Date.now()<deadline)await new Promise(r=>setTimeout(r,40));
 assert.equal(gatewayCalls,1,"A mixed greeting and instruction goes to the permission-gated gateway");
 assert.equal(assistantCalls,5,"Mixed request not swallowed by conversational route");
 console.log("control-center conversational routing: real browser, greetings and capabilities in both modes; no supervisor jobs; mixed actions gated");
}finally{
 await page.close();await browser.close();
 await new Promise<void>(resolve=>server.close(()=>resolve()));
}
process.exit(0);
