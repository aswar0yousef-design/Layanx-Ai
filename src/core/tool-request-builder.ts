import type {Mission,MissionToolPlan,PermissionLevel,ToolRequest} from "./types.js";
import type {ToolCatalogEntry} from "./tool-catalog.js";

const rank:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};

export interface ToolRequestBuildContext{
  agentId:string;
  projectId:string;
  capabilityId:string;
  payload?:unknown;
}

export class ToolRequestBuilder{
  build(mission:Mission,plan:MissionToolPlan,context:ToolRequestBuildContext,catalog:ToolCatalogEntry[]):ToolRequest{
    const definition=catalog.find(tool=>tool.name===plan.tool);
    if(!definition)throw new Error("Tool plan is outside the allowed catalog.");
    if(!definition.actions.some(action=>action.toLowerCase()===plan.action.toLowerCase()))
      throw new Error("Tool plan action is outside the allowed catalog.");
    if(rank[plan.permission]<rank[definition.permission])throw new Error("Tool plan permission is below the tool requirement.");
    if(rank[plan.permission]>rank[mission.requiredPermission])throw new Error("Tool plan permission exceeds mission scope.");
    if(!context.agentId||!context.projectId||!context.capabilityId)throw new Error("Execution context is incomplete.");
    const idempotencyKey=this.key(mission.id,context.agentId,plan.tool,plan.action);
    return{
      missionId:mission.id,
      agentId:context.agentId,
      tool:plan.tool,
      action:plan.action,
      permission:plan.permission,
      idempotencyKey,
      payload:context.payload??{}
    };
  }

  buildAll(mission:Mission,context:ToolRequestBuildContext,catalog:ToolCatalogEntry[]):ToolRequest[]{
    return (mission.tools??[]).map(plan=>this.build(mission,plan,context,catalog));
  }

  private key(missionId:string,agentId:string,tool:string,action:string):string{
    const raw=[missionId,agentId,tool,action].join(":").toLowerCase();
    let hash=2166136261;
    for(let i=0;i<raw.length;i++){hash^=raw.charCodeAt(i);hash=Math.imul(hash,16777619);}
    return "tool-"+(hash>>>0).toString(16);
  }
}
