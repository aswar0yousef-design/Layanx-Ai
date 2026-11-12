import type {ModelExecutionRouter} from "./model-execution.js";
import type {PermissionLevel} from "./types.js";
import type {ToolCatalogEntry} from "./tool-catalog.js";
import type {ModelRoutingOptions} from "../models/inference.js";
import {isDevelopmentGoal as isDevelopmentIntent,normalizeArabic,selectToolsForGoal} from "../providers/tool-selection.js";
import {openRequest} from "../tools/open-app.js";
import {leadRequest,siteFrom} from "../business/lead-research.js";
import {webFormRequest} from "../tools/web-form.js";
import {storeChangeRequest,storeReportRequest} from "../business/woocommerce.js";
import {shippingIntent} from "../business/store-shipping.js";

export interface PlannedTool{
  /** As MissionToolPlan.final: the mission is done once this step succeeds. */
  final?:boolean;
  tool:string;
  action:string;
  permission:PermissionLevel;
  reason:string;
  payload?:Record<string,unknown>;
}

// Whole-word, Arabic-aware intent check (the old substring check matched "latest" as "test",
// "prefix" as "fix" and every sentence containing "المشروع").
const isDevelopmentGoal=isDevelopmentIntent;
// Small local models choose badly from ~100 tools; send only the best matches for non-development goals.
const PLANNER_TOOL_BUDGET=Math.max(0,Number(process.env.LAYANX_PLANNER_TOOL_BUDGET??16)||0);
function filterCatalogForGoal(goal:string,catalog:ToolCatalogEntry[]):ToolCatalogEntry[]{
 if(!isDevelopmentGoal(goal))return PLANNER_TOOL_BUDGET>0?selectToolsForGoal(goal,catalog,PLANNER_TOOL_BUDGET):catalog;
 const allowedPrefixes=["project.","terminal.","files.","git.","development.","runtime.","mission.","memory.","browser.read","github.repo.read","github.issues.list","github.prs.list"];
 return catalog.filter(tool=>allowedPrefixes.some(prefix=>tool.name===prefix||tool.name.startsWith(prefix)));
}

/** "Open Chrome" / «افتح واتساب» / "open youtube.com": one step, no model (it used to invent a tool that does not exist). */
function currentMilestoneGoal(goal:string):string{
 const milestone=goal.split(/\r?\n/).find(line=>/^Current milestone \(\d+\/\d+\):\s*/i.test(line));
 return milestone?milestone.replace(/^Current milestone \(\d+\/\d+\):\s*/i,"").trim():goal;
}

/** Route source-code generation to an installed specialised coding model, if any. */
function codingGoal(goal:string):boolean{
 const step=currentMilestoneGoal(goal);
 return /(?:\b(?:javascript|typescript|node\.js|coding|source code|implement|refactor|server|module|package\.json|test suite|web app|application)\b|\.(?:mjs|cjs|js|jsx|ts|tsx|py)\b|(?:src|tests)\/)/i.test(step);
}

/** A window-presence check is deterministic too: ask Windows to focus that exact window title. */
function deterministicDesktopWindowCheck(goal:string,catalog:ToolCatalogEntry[]):PlannedMission|undefined{
 const step=currentMilestoneGoal(goal);
 const mentionsNotepad=/(?:notepad|المفكرة|المفكره)/iu.test(step);
 const isCheck=/(?:تحقق|تأكد|افحص|verify|confirm|check)/iu.test(step);
 const isWindow=/(?:نافذة|window)/iu.test(step);
 if(!mentionsNotepad||!isCheck||!isWindow)return undefined;
 const tool=catalog.find(item=>item.name==="desktop.window.find"&&item.actions.some(action=>action.toLowerCase()==="desktop find window"));
 if(!tool)return undefined;
 return{
  risk:"low",
  requiredPermission:tool.permission,
  steps:[{description:"Inspect the Windows UI Automation window list and confirm that Notepad is present."}],
  successCriteria:["result.exists === true","result.visible === true",'result.title contains "Notepad"'],
  stopCondition:"Stop and report the window-verification result; do not use a window-focus action just to verify visibility.",
  tools:[{tool:tool.name,action:"desktop find window",permission:tool.permission,reason:"The owner asked to confirm that the Notepad window is open; this read-only check does not change focus.",payload:{title:"Notepad"}}]
 };
}

function deterministicOpenPlan(goal:string,catalog:ToolCatalogEntry[]):PlannedMission|undefined{
 // Supervisor tasks wrap the actionable step in a larger goal; use the named current milestone.
 const request=openRequest(currentMilestoneGoal(goal));
 const tool=catalog.find(t=>t.name==="desktop.app.open");
 if(!request||!tool)return undefined;
 return{risk:"low",requiredPermission:tool.permission,
  steps:[{description:"Execute: open "+request.label+" on this computer."}],
  successCriteria:["The program or web page was opened."],
  stopCondition:"Stop if the program is not installed or the web address is not valid.",
  tools:[{tool:tool.name,action:tool.actions[0]!,permission:tool.permission,reason:"The owner asked to open "+request.label+".",
   payload:{...(request.app?{app:request.app}:{}),...(request.url?{url:request.url}:{})},final:true}]};
}

/**
 * "Take a screenshot and describe what you see" is one step: the capture. The reply describing it is written from the
 * image afterwards (core/task-answer.ts). Without this the planner added a step that does not exist and the task failed
 * after a successful capture. Only a pure look-at-the-screen request: anything that also acts goes to the planner.
 */
export function screenLookRequest(goal:string):boolean{
 const v=normalizeArabic(currentMilestoneGoal(goal)).toLowerCase();
 const screen=/(?:شاشه|screen|desktop|سطح المكتب)/u.test(v);
 const look=/(?:التقط|لقطه|صوره|صف |وصف|اوصف|ترى|تراه|تشاهد|screenshot|describe|what(?:'s| is) on|what do you see|look at)/u.test(v);
 const acts=/(?:افتح|اضغط|انقر|اكتب|ارسل|احذف|اغلق|شغل|ثم|بعدها|click|type|open|send|delete|close|then)/u.test(v);
 return screen&&look&&!acts;
}
function deterministicScreenPlan(goal:string,catalog:ToolCatalogEntry[]):PlannedMission|undefined{
 const tool=catalog.find(t=>t.name==="desktop.screenshot");
 if(!tool||!screenLookRequest(goal))return undefined;
 return{risk:"low",requiredPermission:tool.permission,
  steps:[{description:"Execute: capture the screen."}],
  successCriteria:["The screen was captured."],
  stopCondition:"Stop if the screen cannot be captured.",
  tools:[{tool:tool.name,action:tool.actions[0]!,permission:tool.permission,reason:"The owner asked what is on the screen; the reply is written from this capture.",payload:{},final:true}]};
}

/** "Find potential customers for layanx.com" is one step: research.leads does read-site -> customer types -> searches -> companies. */
function deterministicLeadPlan(goal:string,catalog:ToolCatalogEntry[]):PlannedMission|undefined{
 const step=currentMilestoneGoal(goal);
 const tool=catalog.find(t=>t.name==="research.leads");
 if(!tool||!leadRequest(step))return undefined;
 const site=siteFrom(step)!;
 return{risk:"low",requiredPermission:tool.permission,
  steps:[{description:"Read "+site+", work out which companies would buy from it, and search the web for real ones."}],
  successCriteria:["Potential customers were listed with links from the search results."],
  stopCondition:"Stop if the site cannot be read.",
  tools:[{tool:tool.name,action:tool.actions[0]!,permission:tool.permission,reason:"The owner asked for potential customers of "+site+".",payload:{site,goal:step.slice(0,500)},final:true}]};
}

/** "Open <url> and get a quote / send a message": one step, web.form fills the site's own form and returns its answer. */
function deterministicWebFormPlan(goal:string,catalog:ToolCatalogEntry[]):PlannedMission|undefined{
 const step=currentMilestoneGoal(goal);
 const tool=catalog.find(t=>t.name==="web.form"),url=webFormRequest(step);
 if(!tool||!url)return undefined;
 return{risk:"medium",requiredPermission:tool.permission,
  steps:[{description:"Fill and submit the form on "+url+" as the owner asked, and read the page the site answers with."}],
  successCriteria:["result.submitted === true"],
  stopCondition:"Stop if the page has no form for this request or a needed value is missing.",
  tools:[{tool:tool.name,action:tool.actions[0]!,permission:tool.permission,reason:"The owner asked to do this on "+url+".",payload:{url,goal:step.slice(0,1000)},final:true}]};
}

/** "Prepare shipments for the store's orders", "invoice for order 1041", "close the delivered orders", "shipping report". */
function deterministicShippingPlan(goal:string,catalog:ToolCatalogEntry[]):PlannedMission|undefined{
 const step=currentMilestoneGoal(goal),intent=shippingIntent(step);
 if(!intent)return undefined;
 const spec={
  prepare:{tool:"shipping.from_store",payload:{goal:step.slice(0,500)},step:"Prepare draft shipments for the store's orders that wait to ship.",done:"Shipments were prepared or the reasons listed.",risk:"low" as const},
  invoice:{tool:"shipping.invoice.document",payload:{goal:step.slice(0,500),order:intent.kind==="invoice"?intent.order:""},step:"Write the customer's invoice for the order as a file.",done:"The invoice file was written.",risk:"low" as const},
  close:{tool:"shipping.store.close",payload:{goal:step.slice(0,500)},step:"Set the store orders whose shipments were delivered to completed, and read them back.",done:"Delivered orders were closed in the store.",risk:"medium" as const},
  report:{tool:"shipping.report",payload:{},step:"Report the shipments by carrier.",done:"The shipping report was read.",risk:"low" as const}
 }[intent.kind];
 const tool=catalog.find(t=>t.name===spec.tool);
 if(!tool)return undefined;
 return{risk:spec.risk,requiredPermission:tool.permission,steps:[{description:spec.step}],successCriteria:[spec.done],
  stopCondition:"Stop if the store or the shipping desk cannot be read.",
  tools:[{tool:tool.name,action:tool.actions[0]!,permission:tool.permission,reason:"The owner asked: "+step.slice(0,120),payload:spec.payload,final:true}]};
}

/** "How many orders today in my store" reads the store; "lower the price of X to 40 in my store" is one approved change. */
function deterministicStorePlan(goal:string,catalog:ToolCatalogEntry[]):PlannedMission|undefined{
 const step=currentMilestoneGoal(goal);
 if(storeChangeRequest(step)){
  const tool=catalog.find(t=>t.name==="store.change");if(!tool)return undefined;
  return{risk:"medium",requiredPermission:tool.permission,
   steps:[{description:"Make the one change the owner asked for in their WooCommerce store and read it back from the store."}],
   successCriteria:["result.verified === true"],
   stopCondition:"Stop if the product or order, or the new value, is not clear from the request.",
   tools:[{tool:tool.name,action:tool.actions[0]!,permission:tool.permission,reason:"The owner asked to change their store.",payload:{goal:step.slice(0,800)},final:true}]};
 }
 const tool=catalog.find(t=>t.name==="store.report");
 if(!tool||!storeReportRequest(step))return undefined;
 return{risk:"low",requiredPermission:tool.permission,
  steps:[{description:"Read the owner's WooCommerce store: orders, sales and stock."}],
  successCriteria:["The store's orders and stock were read."],
  stopCondition:"Stop if the store is not connected.",
  tools:[{tool:tool.name,action:tool.actions[0]!,permission:tool.permission,reason:"The owner asked about their store.",payload:{goal:step.slice(0,500)},final:true}]};
}

function deterministicDevelopmentPlan(goal:string,catalog:ToolCatalogEntry[]):PlannedMission|undefined{
 const value=goal.toLowerCase().trim();
 // Only a PURE verification request ("run the tests", "شغّل البناء") may skip the model. Any request
 // to create or change something ("build a website", "ابنِ موقعاً", "fix ... and test") must be planned:
 // matching the bare words test/build turned whole development tasks into a single verification step.
 if(value.length>120||value.includes("\n"))return undefined;
 if(/\b(create|add|implement|write|fix|make|develop|design|refactor|update|change|remove|build (a|an|me|the|new)|new)\b|أنشئ|انشئ|أضف|اضف|اكتب|أصلح|اصلح|طوّر|طور|صمم|ابن |ابنِ|إنشاء|انشاء|برمج|عدّل|عدل|غيّر|احذف/.test(value))return undefined;
 if(!/\b(run|execute|check|verify|start)\b|شغ|نفذ|نفّذ|افحص|تحقق|جرّب|جرب/.test(value))return undefined;
 const verification=value.includes("test")||value.includes("اختبار")||value.includes("اختبارات")
   ? "test"
   : value.includes("typecheck")||value.includes("type check")||value.includes("types")||value.includes("تايب")
     ? "typecheck"
     : value.includes("build")||value.includes("compile")||value.includes("بناء")||value.includes("ترجمة")
       ? "build" : undefined;
 if(!verification)return undefined;
 const tool=catalog.find(item=>item.name==="project.verify"&&item.actions.some(action=>action.toLowerCase()==="verify project"));
 if(!tool||tool.permission!=="L4_EXECUTE")return undefined;
 return{
  risk:"medium",
  requiredPermission:"L4_EXECUTE",
  steps:[{description:"Run the requested project verification script."}],
  successCriteria:["The verification script completes and its result is reported."],
  stopCondition:"Stop if the project verification script cannot be executed or is blocked by policy.",
  tools:[{
   tool:tool.name,
   action:"verify project",
   permission:"L4_EXECUTE",
   reason:"The goal explicitly requests project verification.",
   payload:{script:verification}
  }]
 };
}

function parseModelJson(raw:string,context:string):unknown{
 const cleaned=raw.trim().replace(/^\x60\x60\x60(?:json)?\s*/i,"").replace(/\s*\x60\x60\x60$/,"").trim();
 try{return JSON.parse(cleaned);}catch{}
 const starts=[cleaned.indexOf("{"),cleaned.indexOf("[")].filter(x=>x>=0).sort((a,b)=>a-b);
 for(const start of starts){
  const opener=cleaned[start];const closer=opener==="{"?"}":"]";let depth=0;let quoted=false;let escaped=false;
  for(let i=start;i<cleaned.length;i++){
   const ch=cleaned[i];
   if(quoted){if(escaped)escaped=false;else if(ch==="\\")escaped=true;else if(ch==='"')quoted=false;continue;}
   if(ch==='"'){quoted=true;continue;}
   if(ch===opener)depth++;else if(ch===closer){depth--;if(depth===0){const candidate=cleaned.slice(start,i+1);try{return JSON.parse(candidate);}catch{break;}}}
  }
 }
 throw new Error(context+" returned invalid JSON.");
}

const PERMISSIONS=["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE","L5_CRITICAL"];

/** One schema branch per catalog tool, so constrained decoding can only produce real tool/action/permission triples. */
function toolCallSchema(catalog:ToolCatalogEntry[]):Record<string,unknown>{
 if(!catalog.length)return{type:"object",properties:{tool:{type:"string"},action:{type:"string"},permission:{type:"string",enum:PERMISSIONS},reason:{type:"string"},payload:{type:"object"}},required:["tool","action","permission","reason"]};
 return{anyOf:catalog.map(tool=>({type:"object",properties:{tool:{type:"string",enum:[tool.name]},action:{type:"string",enum:tool.actions.length?tool.actions:[""]},permission:{type:"string",enum:[tool.permission]},reason:{type:"string"},payload:{type:"object"}},required:["tool","action","permission","reason"]}))};
}
/** JSON Schema for a whole mission plan (Ollama structured outputs). */
export function missionPlanSchema(catalog:ToolCatalogEntry[]):Record<string,unknown>{
 return{type:"object",properties:{
  risk:{type:"string",enum:["low","medium","high","critical"]},
  requiredPermission:{type:"string",enum:PERMISSIONS},
  steps:{type:"array",minItems:1,items:{type:"object",properties:{description:{type:"string"}},required:["description"]}},
  successCriteria:{type:"array",minItems:1,items:{type:"string"}},
  stopCondition:{type:"string"},
  tools:{type:"array",items:toolCallSchema(catalog)}
 },required:["risk","requiredPermission","steps","successCriteria","stopCondition","tools"]};
}
/** JSON Schema for the adaptive planner: one tool call, or null when the mission is complete. */
export function nextToolSchema(catalog:ToolCatalogEntry[]):Record<string,unknown>{
 const call=toolCallSchema(catalog);
 return{anyOf:[{type:"null"},...(Array.isArray(call.anyOf)?call.anyOf as Record<string,unknown>[]:[call])]};
}

/**
 * Context budget. Ollama silently drops the *start* of a prompt that exceeds num_ctx, which is where
 * the instructions are. The variable parts (latest result, memory, project context) are trimmed to fit
 * the smallest local context window (LAYANX_OLLAMA_CONTEXT, ~3 characters per token, 30% kept for the answer).
 */
export function promptBudgetChars(env:NodeJS.ProcessEnv=process.env):number{
 const explicit=Number(env.LAYANX_PROMPT_BUDGET_CHARS);
 if(Number.isFinite(explicit)&&explicit>=2000)return Math.floor(explicit);
 let ctx=Number(env.LAYANX_OLLAMA_NUM_CTX)||8192;
 try{const sizes=Object.values(JSON.parse(env.LAYANX_OLLAMA_CONTEXT??"{}") as Record<string,unknown>).filter((v):v is number=>typeof v==="number"&&v>=1024);if(sizes.length)ctx=Math.min(...sizes);}catch{}
 return Math.max(6000,Math.floor(ctx*3*0.7));
}
/** Share what is left after the fixed text between the variable sections (by weight, each with its own cap). */
export function fitSections(fixedChars:number,sections:Array<{text:string;weight:number;max:number}>,budget=promptBudgetChars()):string[]{
 let left=Math.max(1500,budget-fixedChars);
 const out=sections.map(()=>"");
 const order=sections.map((s,i)=>({...s,i})).sort((a,b)=>a.text.length-b.text.length);
 let weights=order.reduce((n,s)=>n+s.weight,0);
 for(const s of order){
  const share=Math.floor(left*s.weight/Math.max(weights,1e-9));
  const limit=Math.min(s.max,share);
  out[s.i]=s.text.length<=limit?s.text:s.text.slice(0,Math.max(0,limit-40))+" …[trimmed to fit the model's context]";
  left-=out[s.i]!.length;weights-=s.weight;
 }
 return out;
}

export interface PlannedMission{
  risk:"low"|"medium"|"high"|"critical";
  requiredPermission:PermissionLevel;
  steps:Array<{description:string}>;
  successCriteria:string[];
  stopCondition:string;
  tools:PlannedTool[];
}

/** A criterion about the result that the verifier cannot evaluate (natural language dressed as a result field). */
export function isUnsupportedCriterion(c:string):boolean{
  const t=c.trim();
  return/^result\b/i.test(t)&&
    !(/^result(?:\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)?(?:\s*(?:===|==|!==|!=|>=|<=|>|<)\s*(?:"[^"]*"|'[^']*'|true|false|null|-?\d+(?:\.\d+)?)|\s+contains\s+(?:"[^"]*"|'[^']*'|true|false|null|-?\d+(?:\.\d+)?)|\s+(?:exists|is present|is not empty))$/i.test(t)
      ||/^result\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/i.test(t));
}
/** "result.url === http://x/contact" -> "result.url === \"http://x/contact\"": the value was meant as text. */
export function quoteCriterionValue(c:string):string{
  const m=/^(result(?:\.[A-Za-z_$][\w$]*)*)\s*(===|==|!==|!=|contains)\s*(.+)$/i.exec(c.trim());
  if(!m)return c;
  const value=m[3]!.trim();
  if(/^(?:"[^"]*"|'[^']*'|true|false|null|-?\d+(?:\.\d+)?)$/i.test(value)||/["']/.test(value))return c;
  return `${m[1]} ${m[2]} "${value}"`;
}
export class AiMissionPlanner{
  constructor(private readonly models:ModelExecutionRouter){}
  async plan(goal:string,tools:ToolCatalogEntry[]=[],projectContext?:unknown,routing?:ModelRoutingOptions):Promise<PlannedMission>{
    if(!goal.trim())throw new Error("Mission goal is empty.");
    const windowCheck=deterministicDesktopWindowCheck(goal,tools);
    if(windowCheck)return windowCheck;
    const opening=deterministicOpenPlan(goal,tools);
    if(opening)return opening;
    const look=deterministicScreenPlan(goal,tools);
    if(look)return look;
    const leads=deterministicLeadPlan(goal,tools);
    if(leads)return leads;
    const form=deterministicWebFormPlan(goal,tools);
    if(form)return form;
    const shipping=deterministicShippingPlan(goal,tools);
    if(shipping)return shipping;
    const store=deterministicStorePlan(goal,tools);
    if(store)return store;
    const scopedTools=filterCatalogForGoal(goal,tools);
    const deterministic=deterministicDevelopmentPlan(goal,scopedTools);
    if(deterministic)return deterministic;
    const catalog=scopedTools.length?scopedTools.map(tool=>({
      name:tool.name,description:tool.description,permission:tool.permission,
      dangerous:tool.dangerous,actions:tool.actions,tags:tool.tags
    })):[];
    const basePrompt=[
      "You are the LayanX mission planner.",
      "Return ONLY valid JSON with keys: risk, requiredPermission, steps, successCriteria, stopCondition, tools.",
      "Every required key must be present. steps and successCriteria must each contain at least one item.",
      "Prefer checkable successCriteria about the final tool result: \"done\", \"result.exitCode === 0\", \"result.<field> contains \\\"text\\\"\", \"result.<field> === <value>\", \"result.length > 0\". Plain sentences are accepted only when the final result reports no failure.",
      "Verification receives the raw data returned by the last tool, not an automatically nested wrapper. Never invent result properties or wrapper paths. Use only fields documented by the selected tool; for runtime.status, result has flat system and ready fields, so use result.ready === true or result.system contains \"LayanX AI\". Nested result paths are supported only when the tool actually returns nested data.",
      "Include at least one step that performs the work (for example \"Execute ...\", \"Write ...\", \"تنفيذ ...\").",
      "risk must be low|medium|high|critical.",
      "requiredPermission must be L1_READ|L2_ANALYZE|L3_MODIFY|L4_EXECUTE|L5_CRITICAL.",
      "steps must be an array of concise objects with description strings.",
      "tools must be an array of objects with tool, action, permission, reason, and optional JSON payload.",
      "Only choose tools from the supplied catalog. Do not invent tool names or actions.",
      "For project.verify use payload {script:\"test\"}, {script:\"typecheck\"}, or {script:\"build\"} according to the goal. For terminal.exec include a safe allowlisted command payload.",
      "For files.list use payload {path:\".\"} to list the current project root (or omit path); for files.read and files.stat supply an existing project-relative file path. Never use an absolute drive path, home folder, leading slash, or path outside the project.",
      "A new project starts as an empty folder: create its files (files.write) or its package.json and packages (project.bootstrap) before project.run or project.verify, which only run an existing project.",
      "When using files.write, supply payload {path:\"src/server.mjs\",content:\"actual complete nonempty source code\"} (or another required relative file). Do not write empty content, placeholders or just filenames. The tool returns {path,bytes,written:true}; use successCriteria [\"result.written === true\"] for the final files.write call. Never write result.fileExists <filename> or pretend file existence was checked.",
      "When the goal needs outside data (exchange rates, weather, maps, products, email checks, test data), call apis.search first for a free public API (prefer auth No with HTTPS), then read its documentation with http.read before writing code for it; never invent an API.",
      "When the goal names a website or business whose work you do not know (for example customers or competitors for a site), first read that site with browser.read or http.read, and only then search for what fits what it actually does. Never guess what a business does from its name.",
      "To open a program or a website use desktop.app.open (payload.app = the program name as the owner said it, or payload.url). For other computer-use goals on Windows, first read the window with desktop.ui.tree and act with desktop.ui.click or desktop.ui.set_text using an element index; use desktop.window.focus to switch apps. Use desktop.screenshot and coordinate-based mouse actions only when the element is missing from the tree or the user supplied exact coordinates.",
      "Do not request secrets or bypass security controls.",
      "Available tool catalog: "+JSON.stringify(catalog),
      "Project intelligence context: "+fitSections(3500+JSON.stringify(catalog).length+goal.length,[{text:JSON.stringify(projectContext??null),weight:1,max:8000}])[0],
      "Goal: "+goal
    ].join("\n");
    const responseSchema=missionPlanSchema(scopedTools);
    const response=await this.models.execute({capability:codingGoal(goal)?"coding":"reasoning",routing,input:basePrompt,responseSchema});
    try{return this.parse(response.output,scopedTools);}
    catch(error){
      if(!(error instanceof Error)||(!error.message.startsWith("Planner success criteria reference runtime.status fields")&&!error.message.startsWith("Unsupported planner success criterion:")&&error.message!=="Incomplete mission plan."))throw error;
      const repair=await this.models.execute({
        capability:"reasoning",routing,responseSchema,
        input:[
          "Repair the following LayanX mission plan.",
          "The original plan failed validation: "+(error instanceof Error?error.message:"invalid plan"),
          "Success criteria must ONLY describe fields in the final selected tool's raw result, never intermediate tools. For files.write, use exactly result.written === true (a documented receipt), never result.fileExists <filename>. Do not test runtime.system or runtime.ready.",
          "Return ONLY valid JSON. Preserve valid fields exactly except invalid success criteria and add missing required fields.",
          "Required fields: risk, requiredPermission, steps (at least one description), successCriteria (at least one string), stopCondition (non-empty string), tools (array).",
          "Do not invent tools. Only use tools from this catalog. Do not increase permissions.",
          "Original plan: "+response.output,
          "Tool catalog: "+JSON.stringify(catalog),
          "Goal: "+goal
        ].join("\n")
      });
      return this.parse(repair.output,scopedTools);
    }
  }
  async nextTool(input:{goal:string;result:unknown;tools:ToolCatalogEntry[];requiredPermission:PermissionLevel;completedTools:string[];successCriteria?:string[];memory?:Array<{kind:string;summary:string;content:unknown;tags:string[]}>;projectContext?:unknown;routing?:ModelRoutingOptions;visualContext?:{mimeType:string;base64:string}}):Promise<PlannedTool|null>{
    if(!input.goal.trim())throw new Error("Mission goal is empty.");
    const scopedTools=filterCatalogForGoal(input.goal,input.tools);
    const catalog=scopedTools.map(tool=>({name:tool.name,description:tool.description,permission:tool.permission,dangerous:tool.dangerous,actions:tool.actions,tags:tool.tags}));
    const fixed=2200+JSON.stringify(catalog).length+input.goal.length+JSON.stringify(input.completedTools).length;
    const [boundedResult,boundedMemory,boundedProject]=fitSections(fixed,[
      {text:JSON.stringify(input.result)??"null",weight:0.45,max:12000},
      {text:JSON.stringify(input.memory??[]),weight:0.25,max:8000},
      {text:JSON.stringify(input.projectContext??null),weight:0.3,max:6000}
    ]) as [string,string,string];
    const prompt=[
      "You are the LayanX adaptive mission planner.",
      "Return ONLY valid JSON: either null when the mission is complete, or an object with tool, action, permission, reason, and optional payload.",
      "Choose exactly one tool from the supplied catalog.",
      "The selected permission must exactly match the catalog tool permission and must not exceed the mission permission.",
      "Do not invent tools or actions. Do not request secrets or bypass security controls.",
      "Evaluate the success criteria against the latest result first. If the criteria are already satisfied, return null and do not call another tool. Choose a tool only when more work is needed. Never repeat a completed tool unless the result clearly shows it failed.",
      "Success criteria: "+JSON.stringify(input.successCriteria??[]),
      "Prefer a tool that advances the goal using the latest result.",
      "For files.list, payload {path:\".\"} lists the project root; other file paths must be project-relative, never absolute. If the latest result reports a path error, repair the relative path instead of repeating the same failed call.",
      "Completed tools: "+JSON.stringify(input.completedTools),
      "Available tool catalog: "+JSON.stringify(catalog),
      "Project intelligence context: "+boundedProject,
      "Mission goal: "+input.goal,
      "Mission memory context: "+boundedMemory,
      "Latest tool result: "+boundedResult
    ].join("\n");
    const modelInput=input.visualContext
      ? [{type:"text" as const,text:prompt},{type:"image" as const,image:input.visualContext}]
      : prompt;
    const response=await this.models.execute({
      capability:input.visualContext?"vision":"reasoning",
      routing:input.routing,
      input:modelInput,
      responseSchema:nextToolSchema(scopedTools)
    });
    const parseNextTool=(raw:string):PlannedTool|null=>{
      const value=parseModelJson(raw,"Adaptive planner");
      if(value===null)return null;
      if(!value||typeof value!=="object")throw new Error("Adaptive planner returned an invalid tool.");
      return this.parseTools([value],scopedTools,input.requiredPermission)[0]??null;
    };
    try{
      return parseNextTool(response.output);
    }catch(firstError){
      // Small local models can ignore a constrained schema once. Re-prompt against the exact same
      // catalog and permission ceiling; never execute the first, untrusted tool suggestion.
      const reason=firstError instanceof Error?firstError.message:"invalid tool response";
      const repair=await this.models.execute({
        capability:input.visualContext?"vision":codingGoal(input.goal)?"coding":"reasoning",
        routing:input.routing,
        input:[
          "Repair this invalid adaptive tool selection for LayanX.",
          "Return ONLY JSON: null if all success criteria are met, otherwise exactly one tool/action/permission/reason object.",
          "Your previous output was rejected: "+reason,
          "Do not invent or rename tools or actions. Choose an exact tool/action/permission triple from the supplied catalog.",
          "The permission must match the catalog and remain within the mission permission ceiling.",
          "If the latest result already satisfies the success criteria, return null. Do not repeat completed tools without evidence they failed.",
          "When fixing a files.list failure, use payload {path:\".\"} for the project root. Never use an absolute workspace path.",
          "Success criteria: "+JSON.stringify(input.successCriteria??[]),
          "Mission goal: "+input.goal,
          "Completed tools: "+JSON.stringify(input.completedTools),
          "Available tool catalog: "+JSON.stringify(catalog),
          "Latest tool result: "+boundedResult,
          "Rejected output: "+response.output.slice(0,4000)
        ].join("\n"),
        responseSchema:nextToolSchema(scopedTools)
      });
      try{
        return parseNextTool(repair.output);
      }catch(secondError){
        const detail=secondError instanceof Error?secondError.message:"invalid repaired tool response";
        throw new Error("Adaptive planner returned an invalid tool after one constrained repair attempt: "+detail);
      }
    }
  }

  private parse(raw:string,catalog:ToolCatalogEntry[]):PlannedMission{
    let value:unknown;
    value=parseModelJson(raw,"Model planner");
    if(!value||typeof value!=="object")throw new Error("Model planner returned an invalid plan.");
    const v=value as Record<string,unknown>;
    if(!["low","medium","high","critical"].includes(String(v.risk)))throw new Error("Invalid mission risk.");
    if(!["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE","L5_CRITICAL"].includes(String(v.requiredPermission)))throw new Error("Invalid mission permission.");
    const steps=Array.isArray(v.steps)?v.steps.filter(x=>x&&typeof x==="object"&&typeof (x as Record<string,unknown>).description==="string").map(x=>({description:String((x as Record<string,unknown>).description)})):[];
    // An unquoted value ("result.browser.url === http://...") is quoted: rejecting the whole plan for it stopped every
    // browser task before a single step (seen live 2026-11-12).
    const successCriteria=(Array.isArray(v.successCriteria)?v.successCriteria.filter(x=>typeof x==="string").map(String):[]).map(quoteCriterionValue);
    const tools=this.parseTools(v.tools,catalog);
    // Small local models repeatedly produce pseudo-criteria like
    // "result.fileExists package.json". When the final selected tool really
    // writes a file, use its *actual* documented receipt instead of asking
    // the model to rewrite a criterion it does not understand. This proves
    // only the write call; supervisor artifact gates verify files separately.
    if(tools.at(-1)?.tool==="files.write"){
      // A file-write result exposes only {path,bytes,written}. A local model
      // sometimes invents arbitrary result.server.respondsTo* booleans.
      // Those fields do not exist in the tool receipt. Replace ONLY those
      // bogus bare-path assertions with the real write receipt; leave any
      // other unsupported assertions subject to strict validation/repair.
      for(let i=0;i<successCriteria.length;i++){
        const criterion=successCriteria[i]!.trim();
        if(/^result\.fileExists\s+[^\s]+$/i.test(criterion)||
          (/^result\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/i.test(criterion)&&
            !/^result\.(?:written|bytes|path)$/i.test(criterion)))
          successCriteria[i]="result.written === true";
      }
      // Multiple invented claims reduce to one write receipt. The separately
      // enforced artifact/behavior gates verify whether the code really works.
      const unique=[...new Set(successCriteria)];
      successCriteria.splice(0,successCriteria.length,...unique);
    }
    // A missing stop condition is not a reason to fail the owner's task; the runtime has its own limits.
    if(typeof v.stopCondition!=="string"||!v.stopCondition.trim())v.stopCondition="Stop when the goal is done, a step fails twice, or approval is needed.";
    if(!steps.length&&tools.length)steps.push(...tools.map(tool=>({description:tool.reason||("Use "+tool.tool)})));
    if(!steps.length||!successCriteria.length)throw new Error("Incomplete mission plan.");
    // A criterion beginning with result. must use the verifier's supported
    // assertion syntax. Reject invented natural-language properties such as
    // "result.createServer exports createServer function" during planning.
    const unsupported=successCriteria.find(isUnsupportedCriterion);
    // One invented criterion among valid ones is dropped; only a plan with nothing checkable left is refused.
    if(unsupported){
      const supported=successCriteria.filter(c=>!isUnsupportedCriterion(c));
      if(!supported.length)throw new Error("Unsupported planner success criterion: "+unsupported.slice(0,160));
      successCriteria.splice(0,successCriteria.length,...supported);
    }
    // Model-supplied mission scope is a proposal, not an authority decision.
    // Derive the minimum scope needed for catalog-approved tools. The catalog is
    // already limited by the agent contract; execution still enforces trust,
    // capability tokens, approvals and Sentinel. Never alter a tool's permission.
    const levels:PermissionLevel[]=["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE","L5_CRITICAL"];
    // For explicit tool plans, scope is EXACTLY the highest catalog tool level.
    // An empty plan retains the declared scope for subsequent adaptive steps.
    const requiredPermission=tools.length
      ?tools.reduce<PermissionLevel>((scope,tool)=>
        levels.indexOf(tool.permission)>levels.indexOf(scope)?tool.permission:scope,"L1_READ")
      :v.requiredPermission as PermissionLevel;
    // Some local models combine fields from several unrelated tool results in
    // successCriteria. The verifier evaluates ONLY the final tool's raw data:
    // checking runtime.status fields after a file/write/research action can
    // never succeed. Reject that contradictory plan instead of retrying a
    // correct tool four times or silently marking an unverified task done.
    const finalTool=tools.at(-1)?.tool;
    if(finalTool&&finalTool!=="runtime.status"&&successCriteria.some(c=>
      /^result\.(?:system|ready)(?:\b|\s|\.)/i.test(c.trim())))
      throw new Error("Planner success criteria reference runtime.status fields but the final tool is "+finalTool+".");
    return{risk:v.risk as PlannedMission["risk"],requiredPermission,steps,successCriteria,stopCondition:String(v.stopCondition),tools};
  }
  private parseTools(value:unknown,catalog:ToolCatalogEntry[],missionPermission?:PermissionLevel):PlannedTool[]{
    if(!Array.isArray(value))return[];
    const byName=new Map(catalog.map(tool=>[tool.name,tool]));
    return value.map(item=>{
      if(!item||typeof item!=="object")throw new Error("Invalid tool plan entry.");
      const entry=item as Record<string,unknown>;
      const tool=typeof entry.tool==="string"?byName.get(entry.tool):undefined;
      const action=typeof entry.action==="string"?entry.action.trim():"";
      const permission=typeof entry.permission==="string"?entry.permission as PermissionLevel:undefined;
      if(!tool||!action||!permission)throw new Error("Planner selected a tool outside the allowed catalog (tool="+String(entry.tool??"<missing>").slice(0,100)+", action="+String(entry.action??"<missing>").slice(0,100)+", permission="+String(entry.permission??"<missing>").slice(0,40)+").");
      if(!tool.actions.map(x=>x.toLowerCase()).includes(action.toLowerCase()))throw new Error("Planner selected an unsupported tool action.");
      const levels:PermissionLevel[]=["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE","L5_CRITICAL"];
      if(!levels.includes(permission))throw new Error("Planner returned an invalid tool permission.");
      const rank=(x:PermissionLevel)=>levels.indexOf(x);
      if(rank(permission)!==rank(tool.permission))throw new Error("Planner tool permission must match the tool requirement.");
      // Initial mission scope is derived from these catalog-validated tools.
      // Adaptive tool selections MUST remain inside the existing mission scope.
      if(missionPermission&&rank(permission)>rank(missionPermission))
        throw new Error("Planner tool permission exceeds mission scope.");
      const payload=entry.payload&&typeof entry.payload==="object"&&!Array.isArray(entry.payload)?entry.payload as Record<string,unknown>:undefined;
      if(payload&&JSON.stringify(payload).length>24576)throw new Error("Planner tool payload is too large.");
      return{tool:tool.name,action,permission,reason:typeof entry.reason==="string"?entry.reason:"",payload};
    });
  }
}
