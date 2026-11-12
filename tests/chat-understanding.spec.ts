import assert from "node:assert/strict";
import {selectToolsForGoal,meaningTokens} from "../src/providers/tool-selection.js";
import {classifyDialogue} from "../src/voice/dialogue-brain.js";
import {VoiceAssistant,compoundDirectAnswer} from "../src/voice/assistant.js";
import {composeTaskAnswer,resultsForAnswer} from "../src/core/task-answer.js";
import {providerError} from "../src/providers/http-model-provider.js";

// The owner's own messages from 2026-11-12 that went wrong.

// 1. "Take a screenshot and describe it" is a command, not a question. A real question stays a question.
assert.equal(classifyDialogue("التقط صورة للشاشة وصف ما تراه").kind,"action");
assert.equal(classifyDialogue("اقرأ بريدي").kind,"action");
assert.equal(classifyDialogue("هل يمكنك التقاط صورة؟").kind,"conversation");

// 2. Two questions LayanX answers itself, asked together, get both answers (who first). Anything else is left to the model.
const both=compoundDirectAnswer("مالذي يمكنك فعله ومن انت","ar",true)!;
assert.ok(both.startsWith("أنا LayanX")&&both.includes("أستطيع"),both);
assert.ok(compoundDirectAnswer("who are you and what can you do","en",true)!.startsWith("I'm LayanX"));
assert.equal(compoundDirectAnswer("ما الذي يمكنك فعله وكم الساعة","ar",true),null);
assert.equal(compoundDirectAnswer("من انت","ar",true),null,"a single question is not compound");

// 3. The tool picker reaches English tool text from Arabic words, ignores words like "عن", and reads possessives.
const catalog=[
  {name:"mcp.registry.search",actions:["search mcp registry","البحث عن أداة MCP"],tags:["mcp","registry","search"],description:"search the official MCP Registry"},
  {name:"apis.search",actions:["search public apis"],tags:["api","catalog"],description:"search a directory of free public APIs"},
  {name:"research.internet",actions:["research internet","بحث شامل في الإنترنت"],tags:["research","internet","search","web","leads","customers"],description:"collect read-only internet research"},
  {name:"desktop.screenshot",actions:["desktop screenshot"],tags:["desktop","screen","vision"],description:"capture the local primary display"},
  {name:"google.gmail.read",actions:["read gmail"],tags:["email","gmail"],description:"read recent Gmail messages"},
  {name:"files.list",actions:["list files"],tags:["files"],description:"list files in a folder"},
  {name:"runtime.status",actions:["runtime status"],tags:["status"],description:"LayanX runtime status"}
];
const top=(goal:string)=>selectToolsForGoal(goal,catalog,2).map(t=>t.name)[0];
assert.equal(top("ابحث لي عن عملاء محتملين لموقع layanx.com"),"research.internet");
assert.equal(top("التقط صورة للشاشة وصف ما تراه"),"desktop.screenshot");
assert.equal(top("اقرأ بريدي الأخير"),"google.gmail.read");
assert.ok(!meaningTokens("ابحث عن عملاء").includes("عن"),"stop words carry no weight");
assert.ok(meaningTokens("بريدي").includes("بريد"),"possessive ending removed");

// 4. A question the model wanted to turn into a task gets a real answer, not a refusal.
const asked:string[]=[];
const assistant=new VoiceAssistant({
  decide:async prompt=>{asked.push(prompt);return asked.length===1?'{"intent":"task","goal":"x","reply":"سأفعل"}':'{"reply":"أستطيع فتح البرامج وقراءة الملفات وتنفيذ المهام بعد موافقتك."}';},
  runTask:async()=>{throw new Error("must not run");},
  report:()=>({}) as never
} as never);
const turn=await assistant.turn({text:"كيف تساعدني في عملي اليومي؟",lang:"ar",allowTasks:false});
assert.equal(turn.intent,"answer");
assert.match(turn.reply,/أستطيع فتح البرامج/);
assert.match(asked[1]!,/in words only/,"the second request asks for an answer only");

// 5. The reply after a task is written from the tools' results; a screenshot is sent as an image; nothing found -> no reply.
const shot={ok:true,tool:"desktop.screenshot",data:{mimeType:"image/jpeg",base64:"AAAA",width:10}};
const r=resultsForAnswer([shot,{ok:true,tool:"research.internet",data:{items:[{title:"Acme Shipping",url:"https://acme.example"}]}},{ok:false,tool:"x",data:{secret:"no"}}]);
assert.equal(r.image?.base64,"AAAA");
assert.ok(!r.text.includes("AAAA")&&r.text.includes("Acme Shipping")&&!r.text.includes("secret"));
const sent:Record<string,unknown>[]=[];
const models={execute:async(req:Record<string,unknown>)=>{sent.push(req);if(req.capability==="vision"&&sent.length===1)return{output:"أرى سطح المكتب وعليه نافذة متصفح.",modelId:"seer"};return{output:"ok",modelId:"m"};}};
const described=await composeTaskAnswer(models as never,"التقط صورة للشاشة وصف ما تراه",[shot],true);
assert.equal(described?.text,"أرى سطح المكتب وعليه نافذة متصفح.");
assert.equal(sent[0]!.capability,"vision");
assert.match(String((sent[0]!.input as {text:string}[])[0]!.text),/Never invent/);
assert.equal(await composeTaskAnswer(models as never,"x",[{ok:false,tool:"y"}],false),null);
// No model sees images: it says so instead of describing something it never saw.
const blind={execute:async()=>{throw new Error("no vision model");}};
assert.match((await composeTaskAnswer(blind as never,"التقط صورة للشاشة",[shot],true))!.text,/لا يوجد نموذج يرى الصور/);

// 6. A quota error delivered as a normal reply is an error (seen live: a Gemini 429 body shown as the answer).
assert.match(providerError(JSON.stringify({error:{code:429,message:"Resource exhausted. Please try again later.",status:"RESOURCE_EXHAUSTED"}},null,2))!,/429 RESOURCE_EXHAUSTED/);
assert.ok(providerError([{error:{code:503}}]));
assert.equal(providerError("The error was fixed in the last version."),null);
assert.equal(providerError({candidates:[]}),null);

console.log("chat understanding: commands, compound questions, Arabic tool choice, real answers and replies written from tool results");

// 7. A pure look-at-the-screen request is one capture step; one that also acts is left to the planner.
const {screenLookRequest}=await import("../src/core/ai-planner.js");
assert.ok(screenLookRequest("التقط صورة للشاشة وصف ما تراه"));
assert.ok(screenLookRequest("what's on my screen?"));
assert.ok(!screenLookRequest("التقط صورة للشاشة ثم افتح كروم"));
assert.ok(!screenLookRequest("التقط صورة لهذا المنتج"),"no screen named");
console.log("chat understanding: a screen look is one capture step");

// 8. Internet research works without Agent Reach installed (seen live: "spawn agent-reach ENOENT" ten times).
const {researchWithFallback,researchQuery}=await import("../src/agent-reach-tools.js");
assert.equal(researchQuery({topic:"leads for layanx.com"}),"leads for layanx.com");
const missing={execute:async()=>{throw new Error("Error: spawn agent-reach ENOENT");}};
const found=await researchWithFallback({payload:{q:"shipping companies Yemen"}} as never,missing,async q=>[{title:"Hit for "+q,url:"https://example.com",snippet:""}]) as {source:string;results:{title:string}[]};
assert.match(found.source,/web search/);
assert.equal(found.results[0]!.title,"Hit for shipping companies Yemen");
await assert.rejects(researchWithFallback({payload:{}} as never,missing,async()=>[]),/needs payload.query/);
const broken={execute:async()=>{throw new Error("rate limited");}};
await assert.rejects(researchWithFallback({payload:{query:"x"}} as never,broken,async()=>[]),/rate limited/,"other failures are not hidden");
console.log("chat understanding: internet research falls back to web search when Agent Reach is missing");

// 9. A reply wrapped in JSON by a small model is shown as words (seen live: { "response":"..." }).
const {unwrapAnswer}=await import("../src/core/task-answer.js");
assert.equal(unwrapAnswer('{ "response":"لا توجد نتائج كافية." }'),"لا توجد نتائج كافية.");
assert.equal(unwrapAnswer("- أولاً\n- ثانياً"),"- أولاً\n- ثانياً");
assert.equal(unwrapAnswer('{"items":[1]}'),'{"items":[1]}',"other JSON is left as it is");
console.log("chat understanding: JSON-wrapped replies are unwrapped");

// 10. The Control Center runs tasks itself (allowTasks:false only means "not from this endpoint"), so "what can you do"
// must not say tasks need turning on (seen live 2026-11-12).
const panel=new VoiceAssistant({decide:async()=>"{}",runTask:async()=>{throw new Error("x");},report:()=>({}) as never} as never);
const can=await panel.turn({text:"ماذا يمكنك أن تفعل؟",lang:"ar",allowTasks:false,tasksRunElsewhere:true});
assert.ok(!can.reply.includes("عند تفعيل"),can.reply);
assert.match(can.reply,/ملفات المشاريع/);
assert.match((await panel.turn({text:"ماذا يمكنك أن تفعل؟",lang:"ar",allowTasks:false})).reply,/عند تفعيل/,"where tasks are really off, it still says so");
const {readFile:readApp}=await import("node:fs/promises");
assert.match(await readApp(new URL("../web/app.js",import.meta.url),"utf8"),/allowTasks:false,tasksRunElsewhere:true/);
console.log("chat understanding: the Control Center does not claim tasks are switched off");

// 11. With only a screenshot, the model is told the image is the result (seen live: "the request is not in the results").
const seen:Record<string,unknown>[]=[];
await composeTaskAnswer({execute:async(req:Record<string,unknown>)=>{seen.push(req);return{output:"أرى MT5.",modelId:"v"};}} as never,"التقط صورة للشاشة وصف ما تراه",[shot],true);
const screenPrompt=String((seen[0]!.input as {text:string}[])[0]!.text);
assert.match(screenPrompt,/IS the screenshot your tool just captured/);
assert.ok(!/do not contain what was asked/.test(screenPrompt));
console.log("chat understanding: a screenshot-only reply is told the image is the result");
assert.equal(unwrapAnswer('{"user_question":"التقط صورة","tool_response":"تظهر الشاشة برنامج MetaTrader مع رسوم بيانية."}'),"تظهر الشاشة برنامج MetaTrader مع رسوم بيانية.","any key: the longest text is the reply (seen live)");
assert.equal(unwrapAnswer('{"status":"ok","count":3}'),'{"status":"ok","count":3}',"short fields are data, not a reply");
console.log("chat understanding: replies wrapped under any key are unwrapped");
