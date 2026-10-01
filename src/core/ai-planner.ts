import type {ModelExecutionRouter} from "./model-execution.js";
import type {PermissionLevel} from "./types.js";
import type {ToolCatalogEntry} from "./tool-catalog.js";

export interface PlannedTool{
  tool:string;
  action:string;
  permission:PermissionLevel;
  reason:string;
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
  async plan(goal:string,tools:ToolCatalogEntry[]=[]):Promise<PlannedMission>{
    if(!goal.trim())throw new Error("Mission goal is empty.");
    const catalog=tools.length?tools.map(tool=>({
      name:tool.name,description:tool.description,permission:tool.permission,
      dangerous:tool.dangerous,actions:tool.actions,tags:tool.tags
    })):[];
    const response=await this.models.execute({
      capability:"reasoning",
      input:[
        "You are the LayanX mission planner.",
        "Return ONLY valid JSON with keys: risk, requiredPermission, steps, successCriteria, stopCondition, tools.",
        "risk must be low|medium|high|critical.",
        "requiredPermission must be L1_READ|L2_ANALYZE|L3_MODIFY|L4_EXECUTE|L5_CRITICAL.",
        "steps must be an array of concise objects with description strings.",
        "tools must be an array of objects with tool, action, permission, reason.",
        "Only choose tools from the supplied catalog. Do not invent tool names or actions.",
        "Do not request secrets or bypass security controls.",
        "Available tool catalog: "+JSON.stringify(catalog),
        "Goal: "+goal
      ].join("\n")
    });
    return this.parse(response.output,tools);
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
    const tools=this.parseTools(v.tools,catalog);
    return{risk:v.risk as PlannedMission["risk"],requiredPermission:v.requiredPermission as PermissionLevel,steps,successCriteria,stopCondition:String(v.stopCondition),tools};
  }
  private parseTools(value:unknown,catalog:ToolCatalogEntry[]):PlannedTool[]{
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
      if(rank(permission)<rank(tool.permission))throw new Error("Planner tool permission is below the tool requirement.");
      if(rank(permission)>rank((tool.permission==="L1_READ"||tool.permission==="L2_ANALYZE"||tool.permission==="L3_MODIFY"||tool.permission==="L4_EXECUTE"||tool.permission==="L5_CRITICAL")?tool.permission:permission))throw new Error("Planner tool permission is not constrained.");
      return{tool:tool.name,action,permission,reason:typeof entry.reason==="string"?entry.reason:""};
    });
  }
}
