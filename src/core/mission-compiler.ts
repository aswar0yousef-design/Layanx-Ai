import type {PlannedMission} from "./ai-planner.js";
import type {Mission,MissionStep,MissionToolPlan} from "./types.js";

export class MissionCompiler{
  compile(plan:PlannedMission,goal:string):Mission{
    if(!goal.trim())throw new Error("Mission goal is empty.");
    if(!plan.steps.length)throw new Error("Mission plan has no steps.");
    const steps:MissionStep[]=plan.steps.map(step=>({id:crypto.randomUUID(),description:step.description,status:"pending"}));
    const tools:MissionToolPlan[]=plan.tools.map(tool=>({tool:tool.tool,action:tool.action,permission:tool.permission,reason:tool.reason,payload:tool.payload}));
    return{
      id:crypto.randomUUID(),goal,status:"planned",risk:plan.risk,
      requiredPermission:plan.requiredPermission,steps,tools,createdAt:new Date().toISOString()
    };
  }
}
