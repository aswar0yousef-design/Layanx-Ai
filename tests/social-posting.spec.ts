import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {inventedNumbers,platformsIn,socialIntent,writeDraft} from "../src/business/social-posting.js";
import {startFakeGraph} from "./fixtures/fake-graph.js";

// The owner's words.
assert.deepEqual(socialIntent("اكتب منشور لانستقرام عن عرض عسل السدر"),{kind:"draft",platforms:["instagram"]});
assert.deepEqual(socialIntent("write a tweet about our new coffee"),{kind:"draft",platforms:["x"]});
assert.deepEqual(socialIntent("جهز بوست للفيس عن افتتاح الفرع"),{kind:"draft",platforms:["facebook"]});
assert.deepEqual(socialIntent("اكتب منشور نصه: وصلت دفعة جديدة من البن"),{kind:"draft",platforms:[],own:"وصلت دفعة جديدة من البن"});
assert.deepEqual(socialIntent("انشر المنشور"),{kind:"publish"});
assert.equal(socialIntent("كيف أكتب منشور جيد؟"),null,"a question stays a conversation");
assert.equal(socialIntent("كم طلب اليوم في متجري"),null);
assert.deepEqual(platformsIn("على فيسبوك وانستغرام"),["instagram","facebook"]);
// A model adding a price or a discount is caught, and asked again.
assert.deepEqual(inventedNumbers("خصم 20% على العسل","اكتب منشور عن عرض العسل"),["20"]);
assert.deepEqual(inventedNumbers("خصم ٢٠٪","اكتب منشور عن خصم 20%"),[]);
{
  const prompts:string[]=[];
  const draft=await writeDraft("اكتب منشور عن وصول عسل السدر",["facebook"],async p=>{prompts.push(p);return prompts.length===1?JSON.stringify({title:"عسل",body:"وصل عسل السدر بخصم 30%!"}):JSON.stringify({title:"عسل",body:"وصل عسل السدر الطبيعي، تعالوا جرّبوه."});});
  assert.equal(draft.body,"وصل عسل السدر الطبيعي، تعالوا جرّبوه.");assert.match(prompts[1]!,/numbers the owner never gave \(30\)/);
  await assert.rejects(writeDraft("اكتب منشور",["x"],async()=>JSON.stringify({title:"t",body:"x".repeat(400)})),/kept adding facts/,"over the X limit twice");
}

// Seen live with a 3B model: an Arabic post with Vietnamese, Spanish, Thai and Italian words. Caught, and asked again.
{
  const {foreignWords}=await import("../src/business/social-posting.js");
  assert.deepEqual(foreignWords("أود أن أعبر عن شغف tôi، تفضلوا nuestros صفحات وهوผล lavorة","اكتب منشور عن عسل السدر"),["tôi","nuestros","وهوผล","lavorة"]);
  assert.deepEqual(foreignWords("وصل عسل السدر من LayanX 🍯 #عسل #honey","اكتب منشور عن عسل السدر من LayanX"),[],"the owner's brand, emoji and hashtags are fine");
  assert.deepEqual(foreignWords("New Sidr honey is here","write a post about our Sidr honey"),[],"an English request may be answered in English");
}
// The whole path through the agent, against a stand-in Facebook Page.
const graph=await startFakeGraph();
const root=fs.mkdtempSync(path.join(os.tmpdir(),"social-"));const dir=path.join(root,"s");fs.mkdirSync(dir);fs.mkdirSync(path.join(root,"p","sp"),{recursive:true});
Object.assign(process.env,{LAYANX_WORKSPACE_ROOT:path.join(root,"p"),LAYANX_STORE_DIR:dir,LAYANX_DATA_DIR:root,LAYANX_DATABASE_URL:"",DATABASE_URL:"",LAYANX_RUNTIME_STORAGE_PATH:path.join(dir,"r.json"),LAYANX_LESSONS_FILE:path.join(dir,"l.json"),LAYANX_TRUST_FILE:path.join(root,"t.json"),LAYANX_SECRET_VAULT_PATH:path.join(dir,"v"),LAYANX_BUSINESS_STORAGE_PATH:path.join(dir,"business.json"),LAYANX_AI_MODE:"local",LAYANX_FREE_POOL_ENABLED:"false",OPENAI_ENABLED:"false",ANTHROPIC_ENABLED:"false",GEMINI_ENABLED:"false",MT5_AUTO_START:"false",
  LAYANX_FACEBOOK_SOCIAL_TOKEN:"page_token_test",LAYANX_FACEBOOK_SOCIAL_BASE_URL:graph.url,LAYANX_HUMANIZER:"off"});
try{
  const {createRuntime}=await import("../src/runtime.js");
  const {composeTaskAnswer}=await import("../src/core/task-answer.js");
  const runtime:any=createRuntime({storagePath:process.env.LAYANX_RUNTIME_STORAGE_PATH});
  const core=runtime.core,business=runtime.business;
  business.upsertSocialAccount({platform:"facebook",name:"صفحة المتجر",externalId:"page1",enabled:true});
  const ask=async(goal:string,approve:(r:any)=>boolean|Promise<boolean>=()=>true)=>{
    let r=await core.runAgentGateway(goal,"sp",6,{},"core",{preferLocal:true});
    for(let i=0;i<3&&r.paused&&r.approvalId;i++){if(!await approve(r))break;core.executionRuntime.approvals.approve(r.approvalId);r=await core.executeAgentLoop(r.missionId,"sp",6,{[r.nextToolIndex]:r.approvalId},"core");}
    return{r,reply:(await composeTaskAnswer(core.modelExecution,goal,r.results??[],r.completed===true))?.text??""};
  };
  // 1. A draft: shown word for word, nothing sent.
  const text="وصلت دفعة جديدة من البن الحرازي، تعالوا جرّبوه في المحل.";
  const drafted=await ask("اكتب منشور للفيس نصه: "+text);
  assert.equal(drafted.r.completed,true);assert.equal(graph.requests.length,0,"drafting publishes nothing");
  assert.ok(drafted.reply.includes(text)&&/لم يُنشر شيء/.test(drafted.reply),drafted.reply);
  // 2. Publishing: the approval carries the exact text; the post is read back from the platform.
  let approvalText="";
  const published=await ask("انشر المنشور",r=>{approvalText=JSON.stringify(core.missions.get(r.missionId)?.tools?.[0]?.payload);return true;});
  assert.ok(approvalText.includes(text),"what the owner approves is the text itself");
  assert.equal(published.r.completed,true,JSON.stringify(published.r.reason));
  assert.deepEqual(graph.posts.map(p=>p.message),[text],"exactly that text, once");
  assert.match(published.reply,/فيسبوك: https:\/\/www.facebook.com\/page1_100 \(قرأته من المنصة: النص مطابق\)/);
  assert.ok(!graph.requests.some(q=>q.path.includes("access_token")),"the token never goes in the address");
  // 3. Approving again does not post again (the draft is published).
  const again=await ask("انشر المنشور");
  assert.equal(graph.posts.length,1);assert.match(again.reply,/لا توجد مسودة منشور/);
  // 4. The draft is changed after the owner saw it: nothing is published.
  await ask("اكتب منشور للفيس نصه: افتتاح الفرع الجديد يوم الخميس");
  const changed=await ask("انشر المنشور",r=>{const id=core.missions.get(r.missionId)?.tools?.[0]?.payload?.contentId;business.updateContent(id,{body:"نص لم يره المالك"});return true;});
  assert.equal(changed.r.completed,false);assert.equal(graph.posts.length,1,"the changed text was not published");
  assert.match(changed.reply,/تغيّرت المسودة بعد أن رأيتها/);
  // 5. An approved post edited afterwards goes back to draft and cannot be published as it is.
  const item=business.createContent({title:"t",body:"نص",platforms:["facebook"],mediaIds:[],status:"draft"});
  business.updateContent(item.id,{status:"approved"});business.updateContent(item.id,{body:"نص آخر"});
  assert.equal(business.snapshot().content.find((c:any)=>c.id===item.id).status,"draft");
}finally{await graph.close();}
{
  // A platform that stores other text than what was sent is reported, not called a success.
  const odd=await startFakeGraph({changeText:t=>t+" [edited]"});
  const {readBack}=await import("../src/business/social-posting.js");
  process.env.LAYANX_FACEBOOK_SOCIAL_BASE_URL=odd.url;
  const r=await fetch(odd.url+"/page1/feed",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({message:"hello",access_token:"page_token_test"})}).then(x=>x.json()) as {id:string};
  assert.equal((await readBack("facebook",r.id)).text,"hello [edited]");
  await odd.close();
}
console.log("social-posting: drafts shown word for word, published only with the approved text, read back from the platform, never twice");
process.exit(0);
