import type {Mission} from "./types.js";

export type AdaptiveStopReason="continue"|"planner_complete"|"success_criteria_met"|"step_limit"|"tool_failure"|"planner_failure"|"blocked";

export interface AdaptiveDecision{
  continue:boolean;
  reason:AdaptiveStopReason;
  detail:string;
}

export class AdaptiveDecisionEngine{
  decide(input:{mission:Mission;toolResult?:unknown;nextToolAvailable:boolean;stepsExecuted:number;maxSteps:number;toolSucceeded?:boolean;plannerSucceeded?:boolean}):AdaptiveDecision{
    if(input.mission.status==="blocked")return{continue:false,reason:"blocked",detail:"Mission is blocked by a security or policy gate."};
    if(input.toolSucceeded===false)return{continue:false,reason:"tool_failure",detail:"The latest tool execution failed."};
    if(input.plannerSucceeded===false)return{continue:false,reason:"planner_failure",detail:"Adaptive planner execution failed."};
    if(input.stepsExecuted>=input.maxSteps)return{continue:false,reason:"step_limit",detail:"Adaptive execution step limit reached."};
    if(!input.nextToolAvailable)return{continue:false,reason:"planner_complete",detail:"Adaptive planner indicated that no further tool is required."};
    return{continue:true,reason:"continue",detail:"Continue with the next constrained tool."};
  }
}
