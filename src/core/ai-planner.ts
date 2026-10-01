import type {ModelExecutionRouter} from "./model-execution.js";
import type {PermissionLevel,MissionStep} from "./types.js";

export interface PlannedMission{
  risk:"low"|"medium"|"high"|"critical";
  requiredPermission:PermissionLevel;
  steps:Array<{description:string}>;
  successCriteria:string[];
  stopCondition:string;
}

export class AiMissionPlanner{
  constructor(private readonly models:ModelExecutionRouter){}
  async plan(goal:string):Promise<PlannedMission>{
    if(!goal.trim())throw new Error("Mission goal is empty.");
    const response=await this.models.execute({
      capability:"reasoning",
      input:[
        "You are the LayanX mission planner.",
        "Return ONLY valid JSON with keys: risk, requiredPermission, steps, successCriteria, stopCondition.",
        "risk must be low|medium|high|critical.",
        "requiredPermission must be L1_READ|L2_ANALYZE|L3_MODIFY|L4_EXECUTE|L5_CRITICAL.",
        "steps must be an array of concise objects with description strings.",
        "Do not request secrets or bypass security controls.",
        "Goal: "+goal
      ].join("\n")
    });
    return this.parse(response.output);
  }
  private parse(raw:string):PlannedMission{
    let value:unknown;
    try{value=JSON.parse(raw);}catch{throw new Error("Model planner returned invalid JSON.");}
    if(!value||typeof value!=="object")throw new Error("Model planner returned an invalid plan.");
    const v=value as Record<string,unknown>;
    if(!["low","medium","high","critical"].includes(String(v.risk)))throw new Error("Invalid mission risk.");
    if(!["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE","L5_CRITICAL"].includes(String(v.requiredPermission)))throw new Error("Invalid mission permission.");
    const steps=Array.isArray(v.steps)?v.steps.filter(x=>x&&typeof x==="object"&&typeof (x as Record<string,unknown>).description==="string").map(x=>({description:String((x as Record<string,unknown>).description)})):[];
    const successCriteria=Array.isArray(v.successCriteria)?v.successCriteria.filter(x=>typeof x==="string").map(String):[];
    if(!steps.length||!successCriteria.length||typeof v.stopCondition!=="string"||!v.stopCondition.trim())throw new Error("Incomplete mission plan.");
    return{risk:v.risk as PlannedMission["risk"],requiredPermission:v.requiredPermission as PermissionLevel,steps,successCriteria,stopCondition:String(v.stopCondition)};
  }
}
