import type {ModelExecutionRouter} from "./model-execution.js";
import type {PermissionLevel} from "./types.js";
import type {ToolCatalogEntry} from "./tool-catalog.js";
import type {ModelRoutingOptions} from "../models/inference.js";

export interface PlannedTool{
  tool:string;
  action:string;
  permission:PermissionLevel;
  reason:string;
  payload?:Record<string,unknown>;
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
    const catalog=tools.length?tools.map(tool=>({
      name:tool.name,description:tool.description,permission:tool.permission,
      dangerous:tool.dangerous,actions:tool.actions,tags:tool.tags
    })):[];
    const response=await this.models.execute({
      capability:"reasoning",
      routing,
      input:[
        "You are the LayanX mission planner.",
        "Return ONLY valid JSON with keys: risk, requiredPermission, steps, successCriteria, stopCondition, tools.",
        "risk must be low|medium|high|critical.",
        "requiredPermission must be L1_READ|L2_ANALYZE|L3_MODIFY|L4_EXECUTE|L5_CRITICAL.",
        "steps must be an array of concise objects with description strings.",
        "tools must be an array of objects with tool, action, permission, reason, and optional JSON payload.",
        "Only choose tools from the supplied catalog. Do not invent tool names or actions.",
        "Do not request secrets or bypass security controls.",
        "Available tool catalog: "+JSON.stringify(catalog),
        "Project intelligence context: "+JSON.stringify(projectContext??null).slice(0,8000),
        "Goal: "+goal
      ].join("\n")
    });
    return this.parse(response.output,tools);
  }
  async nextTool(input:{goal:string;result:unknown;tools:ToolCatalogEntry[];requiredPermission:PermissionLevel;completedTools:string[];memory?:Array<{kind:string;summary:string;content:unknown;tags:string[]}>;projectContext?:unknown;routing?:ModelRoutingOptions}):Promise<PlannedTool|null>{
    if(!input.goal.trim())throw new Error("Mission goal is empty.");
    const catalog=input.tools.map(tool=>({name:tool.name,description:tool.description,permission:tool.permission,dangerous:tool.dangerous,actions:tool.actions,tags:tool.tags}));
    const boundedResult=JSON.stringify(input.result).slice(0,12000);
    const boundedMemory=JSON.stringify(input.memory??[]).slice(0,8000);
    const response=await this.models.execute({
      capability:"reasoning",
      routing:input.routing,
      input:[
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
      ].join("\n")
    });
    let value:unknown;
    try{value=JSON.parse(response.output);}catch{throw new Error("Adaptive planner returned invalid JSON.");}
    if(value===null)return null;
    if(!value||typeof value!=="object")throw new Error("Adaptive planner returned an invalid tool.");
    return this.parseTools([value],input.tools,input.requiredPermission)[0]??null;
  }

  private parse(raw:string,catalog:ToolCatalogEntry[]):PlannedMission{
    let value:unknown;
    try{value=JSON.parse(raw);}catch{throw new Error("Model planner returned invalid JSON.");}
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
