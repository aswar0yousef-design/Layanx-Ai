import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-humanizer-int-"));
process.env.LAYANX_STORE_DIR=root;
process.env.LAYANX_BUSINESS_STORAGE_PATH=path.join(root,"business.json");
process.env.LAYANX_CREATOR_OUTPUT_DIR=path.join(root,"creator");
process.env.LAYANX_CAPABILITIES="all";
process.env.LAYANX_DESKTOP_PREWARM="off";
delete process.env.LAYANX_HUMANIZER;
const {createRuntime}=await import("../src/runtime.js");
const {BusinessManager}=await import("../src/business/manager.js");
const {CreatorEngine}=await import("../src/creator/engine.js");
const {startRuntimeApi}=await import("../src/api-server.js");
const {LayanXCore}=await import("../src/core/orchestrator.js");
const ZWSP=String.fromCodePoint(0x200B);
const AI="In today's fast-paced world, our innovative frankincense seamlessly elevates your home. Moreover, it's worth noting that it is crucial for a vibrant mood. Whether you're a collector or a beginner, this robust resin is a game-changer. Only 5 OMR. In conclusion, the future looks bright.";
const HUMAN="Hojari frankincense from Dhofar, the green grade. One piece on a coal fills the majlis for an hour. 5 OMR for 100g, this week only.";

// ---------- one tool, reachable by the roles that write for people ----------
{
  const runtime=createRuntime({storagePath:path.join(root,"runtime.json")}) as any;
  const core=runtime.core;
  const defs=core.tools.list().filter((t:any)=>t.name==="content.humanize");
  assert.equal(defs.length,1);assert.equal(defs[0].dangerous,false);assert.equal(defs[0].permission,"L2_ANALYZE");
  for(const agent of ["core","business","coder"])assert.ok(core.agents.get(agent).allowedTools.includes("content.humanize"),agent);
  assert.ok(!core.agents.get("tester").allowedTools.includes("content.humanize"));
  const run=(payload:any)=>core.toolAdapters.get("content.humanize").execute({missionId:"m",agentId:"business",projectId:"default",tool:"content.humanize",action:"content.humanize",permission:"L2_ANALYZE",idempotencyKey:"k",payload});
  const checked=await run({text:AI,platform:"instagram",mode:"check"});
  assert.equal(checked.mode,"check");assert.equal(checked.report.verdict,"fail");
  const cleaned=await run({text:"Fresh"+ZWSP+" bread at 7",mode:"clean"});
  assert.equal(cleaned.text,"Fresh bread at 7");
  await assert.rejects(run({}),/humanize_text_required/);
  process.env.LAYANX_HUMANIZER="clean";
  const limited=await run({text:AI});
  assert.equal(limited.mode,"clean");assert.equal(limited.note,"rewrite_disabled","the owner's switch also holds for the agent");
  delete process.env.LAYANX_HUMANIZER;
}

// ---------- drafts: cleaned on save, rewritten when generated, quality saved for the owner ----------
{
  const prompts:string[]=[];
  const b=new BusinessManager(undefined,async()=>JSON.stringify({title:"Hojari",body:AI,hashtags:["oman","frankincense","dhofar","luban","gift","salalah","incense"]}),async prompt=>{prompts.push(prompt);return HUMAN;});
  const store=b.createStore({name:"Demo",platform:"generic",baseUrl:"https://example.invalid",enabled:true});
  const product=b.createProduct({storeId:store.id,sku:"H-1",name:"Hojari",description:"Green grade frankincense",price:5,currency:"OMR",inventory:10,images:[],videos:[],tags:["oman"],status:"active"} as any);
  const draft=await b.generateProductContentAI(product.id,["instagram","facebook"]);
  assert.ok(draft.body.startsWith(HUMAN),draft.body);
  assert.equal((draft.body.match(/#/g)??[]).length,5,"Instagram takes at most 5 hashtags");
  assert.equal(draft.quality?.rewritten,true);assert.equal(draft.quality?.platform,"instagram");assert.ok((draft.quality?.humanScore??0)>=80,JSON.stringify(draft.quality));
  assert.match(prompts[0]!,/Instagram/,"written for the strictest platform of the draft");
  assert.equal(draft.status,"draft","still waits for the owner's approval");
  // a draft the owner (or an agent) saves directly is cleaned of hidden traces, words untouched
  const typed=b.createContent({title:"Eid"+ZWSP,body:"Eid offer **today**"+ZWSP,platforms:["x"],mediaIds:[],status:"draft"});
  assert.equal(typed.title,"Eid");assert.equal(typed.body,"Eid offer today");
  const edited=b.updateContent(typed.id,{body:"New"+ZWSP+" text"});
  assert.equal(edited.body,"New text");
  // ad copy is cleaned the same way
  const {AdsManager}=await import("../src/business/ads.js");
  const ads=new AdsManager(b.store);
  const creative=ads.createCreative({name:"c",headline:"**Hojari**"+ZWSP,body:"Green grade"+ZWSP+" from Dhofar",mediaIds:[],metadata:{}});
  assert.equal(creative.headline,"Hojari");assert.equal(creative.body,"Green grade from Dhofar");
  // the model failing never blocks the draft
  const down=new BusinessManager(undefined,async()=>JSON.stringify({title:"Hojari",body:AI,hashtags:["oman"]}),async()=>{throw new Error("model offline");});
  const s2=down.createStore({name:"D",platform:"generic",baseUrl:"https://example.invalid",enabled:true});
  const p2=down.createProduct({storeId:s2.id,sku:"H-2",name:"Hojari",description:"x",price:5,currency:"OMR",inventory:1,images:[],videos:[],tags:[],status:"active"} as any);
  const kept=await down.generateProductContentAI(p2.id,["instagram"]);
  assert.ok(kept.body.includes("Only 5 OMR"));assert.equal(kept.quality?.rewritten,false);assert.match(kept.quality?.note??"",/model_error/);
  // off means off
  process.env.LAYANX_HUMANIZER="off";
  const raw=b.createContent({title:"T"+ZWSP,body:"B"+ZWSP,platforms:["x"],mediaIds:[],status:"draft"});
  assert.equal(raw.body,"B"+ZWSP);
  delete process.env.LAYANX_HUMANIZER;
}

// ---------- video scripts ----------
{
  const script="In today's fast-paced world, frankincense plays a crucial role. Moreover, it's worth noting that Dhofar trees grow on dry hills. Whether you're a tourist or a local, the souq is a game-changer. In conclusion, the future looks bright.";
  const better="Frankincense trees grow on the dry hills of Dhofar. Farmers cut the bark and wait.\nTwo weeks later the resin is ready. You can buy it in Salalah's souq.";
  let asked="";
  const creator=new CreatorEngine({root:path.join(root,"creator"),generateText:async()=>JSON.stringify({title:"Frankincense",hook:"Sure! Here's a hook:\nWhere does frankincense come from?",script}),writer:async prompt=>{asked=prompt;return better;}});
  const project=await creator.plan({topic:"frankincense",platform:"tiktok",language:"en"});
  assert.equal(project.script,better);assert.equal(project.hook,"Where does frankincense come from?");
  assert.equal(project.quality?.rewritten,true);assert.match(asked,/TikTok \(script\)/);
  assert.equal(project.scenes.length,4,"scenes follow the improved script");
}

// ---------- the Control Center API ----------
{
  const core=new LayanXCore();
  const server=startRuntimeApi({core,business:new BusinessManager(),host:"127.0.0.1",port:0,token:"t0k",requireToken:true});
  await new Promise<void>(r=>server.on("listening",()=>r()));
  const base="http://127.0.0.1:"+(server.address() as {port:number}).port;
  const call=async(method:string,p:string,body?:unknown,auth=true)=>{const r=await fetch(base+p,{method,headers:{"content-type":"application/json",...(auth?{authorization:"Bearer t0k"}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});return{status:r.status,json:await r.json() as any};};
  try{
    assert.equal((await call("POST","/v1/content/humanize",{text:AI},false)).status,401);
    const r=await call("POST","/v1/content/humanize",{text:AI,platform:"linkedin",mode:"check"});
    assert.equal(r.status,200);assert.equal(r.json.report.platform,"linkedin");assert.equal(r.json.report.checks.length,6);
    // no model configured on this PC: the text comes back cleaned, with the reason
    const w=await call("POST","/v1/content/humanize",{text:AI+ZWSP});
    assert.equal(w.status,200);assert.equal(w.json.rewritten,false);assert.ok(!w.json.text.includes(ZWSP));assert.ok(w.json.note);
    assert.equal((await call("POST","/v1/content/humanize",{text:""})).status,422);
    assert.equal((await call("GET","/v1/content/voice")).json.voice,null);
    const saved=await call("PUT","/v1/content/voice",{samples:["وصلت دفعة جديدة."],dialect:"عمانية",avoid:["حصرياً"]});
    assert.equal(saved.status,200);assert.equal(saved.json.voice.dialect,"عمانية");
    assert.deepEqual((await call("GET","/v1/content/voice")).json.voice.avoid,["حصرياً"]);
    const withVoice=await call("POST","/v1/content/humanize",{text:"عرض حصرياً اليوم فقط.",mode:"check"});
    assert.equal(withVoice.json.report.checks.find((c:any)=>c.id==="voice").status,"fail","the saved voice profile applies");
  }finally{server.close();}
}
console.log("humanizer-integration: one tool for business and coder, drafts, scripts, API, owner switch");
process.exit(0);
