import type {PlannedMission} from "./ai-planner.js";
import type {Mission,MissionStep} from "./types.js";

export class MissionCompiler{
  compile(plan:PlannedMission,goal:string):Mission{
    if(!goal.trim())throw new Error("Mission goal is empty.");
    if(!plan.steps.length)throw new Error("Mission plan has no steps.");
    const steps:MissionStep[]=plan.steps.map(step=>({id:crypto.randomUUID(),description:step.description,status:"pending"}));
    return{
      id:crypto.randomUUID(),goal,status:"planned",risk:plan.risk,
      requiredPermission:plan.requiredPermission,steps,createdAt:new Date().toISOString()
    };
  }
}
