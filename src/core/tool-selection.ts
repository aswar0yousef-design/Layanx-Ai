import type {AgentContract} from "./contracts.js";
import type {PermissionLevel} from "./types.js";
import type {ToolDefinition,ToolRegistry} from "../tools/registry.js";

const rank:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};

export interface ToolSelection{
  tool:ToolDefinition;
  score:number;
  reasons:string[];
}

export class ToolSelector{
  constructor(private readonly registry:ToolRegistry){}

  select(action:string,contract:AgentContract,requiredPermission:PermissionLevel):ToolSelection[]{
    const words=new Set(action.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
    return this.registry.list()
      .filter(tool=>contract.allowedTools.includes(tool.name))
      .filter(tool=>!contract.forbiddenResources.includes(tool.name))
      .filter(tool=>rank[tool.permission]<=rank[requiredPermission])
      .map(tool=>{
        const haystack=(tool.name+" "+tool.description).toLowerCase();
        const matches=[...words].filter(word=>word.length>2&&haystack.includes(word)).length;
        const reasons:string[]=[];
        if(matches)reasons.push(`${matches} action-term match(es).`);
        if(tool.dangerous)reasons.push("Dangerous tool; execution gate remains required.");
        return{tool,score:matches,reasons};
      })
      .filter(selection=>selection.score>0)
      .sort((a,b)=>b.score-a.score||a.tool.name.localeCompare(b.tool.name));
  }
}
