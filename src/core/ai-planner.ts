import type {ModelExecutionRouter} from "./model-execution.js";
import type {PermissionLevel} from "./types.js";
import type {ToolCatalogEntry} from "./tool-catalog.js";
import type {ModelRoutingOptions} from "../models/inference.js";
import {isDevelopmentGoal as isDevelopmentIntent,selectToolsForGoal} from "../providers/tool-selection.js";

export interface PlannedTool{
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

export interface PlannedMission{
  risk:"low"|"medium"|"high"|"critical";
  requiredPermission:PermissionLevel;
  steps:Array<{description:string}>;
  successCriteria:string[];
  stopCondition:string;
  tools:PlannedTool[];
}

export class AiMissionPlanner{
  constructor(private readonly models:ModelExecutionRouter){}
  async plan(goal:string,tools:ToolCatalogEntry[]=[],projectContext?:unknown,routing?:ModelRoutingOptions):Promise<PlannedMission>{
    if(!goal.trim())throw new Error("Mission goal is empty.");
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
      "Include at least one step that performs the work (for example \"Execute ...\", \"Write ...\", \"تنفيذ ...\").",
      "risk must be low|medium|high|critical.",
      "requiredPermission must be L1_READ|L2_ANALYZE|L3_MODIFY|L4_EXECUTE|L5_CRITICAL.",
      "steps must be an array of concise objects with description strings.",
      "tools must be an array of objects with tool, action, permission, reason, and optional JSON payload.",
      "Only choose tools from the supplied catalog. Do not invent tool names or actions.",
      "For project.verify use payload {script:\"test\"}, {script:\"typecheck\"}, or {script:\"build\"} according to the goal. For terminal.exec include a safe allowlisted command payload.",
      "For computer-use goals on Windows, first read the window with desktop.ui.tree and act with desktop.ui.click or desktop.ui.set_text using an element index; use desktop.window.focus to switch apps. Use desktop.screenshot and coordinate-based mouse actions only when the element is missing from the tree or the user supplied exact coordinates.",
      "Do not request secrets or bypass security controls.",
      "Available tool catalog: "+JSON.stringify(catalog),
      "Project intelligence context: "+JSON.stringify(projectContext??null).slice(0,8000),
      "Goal: "+goal
    ].join("\n");
    const responseSchema=missionPlanSchema(scopedTools);
    const response=await this.models.execute({capability:"reasoning",routing,input:basePrompt,responseSchema});
    try{return this.parse(response.output,scopedTools);}
    catch(error){
      if(!(error instanceof Error)||error.message!=="Incomplete mission plan.")throw error;
      const repair=await this.models.execute({
        capability:"reasoning",routing,responseSchema,
        input:[
          "Repair the following LayanX mission plan.",
          "Return ONLY valid JSON. Preserve valid fields exactly and add missing required fields.",
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
  async nextTool(input:{goal:string;result:unknown;tools:ToolCatalogEntry[];requiredPermission:PermissionLevel;completedTools:string[];memory?:Array<{kind:string;summary:string;content:unknown;tags:string[]}>;projectContext?:unknown;routing?:ModelRoutingOptions;visualContext?:{mimeType:string;base64:string}}):Promise<PlannedTool|null>{
    if(!input.goal.trim())throw new Error("Mission goal is empty.");
    const scopedTools=filterCatalogForGoal(input.goal,input.tools);
    const catalog=scopedTools.map(tool=>({name:tool.name,description:tool.description,permission:tool.permission,dangerous:tool.dangerous,actions:tool.actions,tags:tool.tags}));
    const boundedResult=JSON.stringify(input.result).slice(0,12000);
    const boundedMemory=JSON.stringify(input.memory??[]).slice(0,8000);
    const prompt=[
      "You are the LayanX adaptive mission planner.",
      "Return ONLY valid JSON: either null when the mission is complete, or an object with tool, action, permission, reason, and optional payload.",
      "Choose exactly one tool from the supplied catalog.",
      "The selected permission must exactly match the catalog tool permission and must not exceed the mission permission.",
      "Do not invent tools or actions. Do not request secrets or bypass security controls.",
      "Prefer a tool that advances the goal using the latest result.",
      "Completed tools: "+JSON.stringify(input.completedTools),
      "Available tool catalog: "+JSON.stringify(catalog),
      "Project intelligence context: "+JSON.stringify(input.projectContext??null).slice(0,6000),
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
    let value:unknown;
    value=parseModelJson(response.output,"Adaptive planner");
    if(value===null)return null;
    if(!value||typeof value!=="object")throw new Error("Adaptive planner returned an invalid tool.");
    return this.parseTools([value],scopedTools,input.requiredPermission)[0]??null;
  }

  private parse(raw:string,catalog:ToolCatalogEntry[]):PlannedMission{
    let value:unknown;
    value=parseModelJson(raw,"Model planner");
    if(!value||typeof value!=="object")throw new Error("Model planner returned an invalid plan.");
    const v=value as Record<string,unknown>;
    if(!["low","medium","high","critical"].includes(String(v.risk)))throw new Error("Invalid mission risk.");
    if(!["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE","L5_CRITICAL"].includes(String(v.requiredPermission)))throw new Error("Invalid mission permission.");
    const steps=Array.isArray(v.steps)?v.steps.filter(x=>x&&typeof x==="object"&&typeof (x as Record<string,unknown>).description==="string").map(x=>({description:String((x as Record<string,unknown>).description)})):[];
    const successCriteria=Array.isArray(v.successCriteria)?v.successCriteria.filter(x=>typeof x==="string").map(String):[];
    if(!steps.length||!successCriteria.length||typeof v.stopCondition!=="string"||!v.stopCondition.trim())throw new Error("Incomplete mission plan.");
    const tools=this.parseTools(v.tools,catalog,v.requiredPermission as PermissionLevel);
    return{risk:v.risk as PlannedMission["risk"],requiredPermission:v.requiredPermission as PermissionLevel,steps,successCriteria,stopCondition:String(v.stopCondition),tools};
  }
  private parseTools(value:unknown,catalog:ToolCatalogEntry[],missionPermission:PermissionLevel):PlannedTool[]{
    if(!Array.isArray(value))return[];
    const byName=new Map(catalog.map(tool=>[tool.name,tool]));
    return value.map(item=>{
      if(!item||typeof item!=="object")throw new Error("Invalid tool plan entry.");
      const entry=item as Record<string,unknown>;
      const tool=typeof entry.tool==="string"?byName.get(entry.tool):undefined;
      const action=typeof entry.action==="string"?entry.action.trim():"";
      const permission=typeof entry.permission==="string"?entry.permission as PermissionLevel:undefined;
      if(!tool||!action||!permission)throw new Error("Planner selected a tool outside the allowed catalog.");
      if(!tool.actions.map(x=>x.toLowerCase()).includes(action.toLowerCase()))throw new Error("Planner selected an unsupported tool action.");
      const levels:PermissionLevel[]=["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE","L5_CRITICAL"];
      if(!levels.includes(permission))throw new Error("Planner returned an invalid tool permission.");
      const rank=(x:PermissionLevel)=>levels.indexOf(x);
      if(rank(permission)!==rank(tool.permission))throw new Error("Planner tool permission must match the tool requirement.");
      if(rank(permission)>rank(missionPermission))throw new Error("Planner tool permission exceeds mission scope.");
      const payload=entry.payload&&typeof entry.payload==="object"&&!Array.isArray(entry.payload)?entry.payload as Record<string,unknown>:undefined;
      if(payload&&JSON.stringify(payload).length>4096)throw new Error("Planner tool payload is too large.");
      return{tool:tool.name,action,permission,reason:typeof entry.reason==="string"?entry.reason:"",payload};
    });
  }
}
