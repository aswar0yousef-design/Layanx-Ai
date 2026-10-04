import type {AgentContract} from "./contracts.js";
import type {PermissionLevel} from "./types.js";
import type {ToolDefinition,ToolRegistry} from "../tools/registry.js";
import {ToolCatalog} from "./tool-catalog.js";

const rank:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};

export interface ToolSelection{tool:ToolDefinition;score:number;reasons:string[];recommendedAction:string;}

export class ToolSelector{
  private readonly catalog:ToolCatalog;
  constructor(private readonly registry:ToolRegistry){this.catalog=new ToolCatalog(registry);}

  select(action:string,contract:AgentContract,requiredPermission:PermissionLevel):ToolSelection[]{
    const words=terms(action);
    return this.catalog.discover({action,permission:requiredPermission},contract)
      .map(publicTool=>{
        const tool=this.registry.get(publicTool.name);
        const haystack=[tool.name,tool.description,...(tool.actions??[]),...(tool.tags??[])].join(" ").toLowerCase();
        const matches=[...words].filter(word=>haystack.includes(word)).length;
        const exactActions=(tool.actions??[]).filter(candidate=>[...terms(candidate)].every(term=>words.has(term))).length;
        const tagMatches=(tool.tags??[]).filter(tag=>words.has(tag)).length;
        const score=matches+exactActions*3+tagMatches*2;
        const reasons:string[]=[];
        if(matches)reasons.push(`${matches} action-term match(es).`);
        if(exactActions)reasons.push(`${exactActions} explicit action match(es).`);
        if(tagMatches)reasons.push(`${tagMatches} tag match(es).`);
        if(tool.dangerous)reasons.push("Dangerous tool; execution gate remains required.");
        const recommendedAction=(tool.actions??[]).find(candidate=>[...terms(candidate)].every(term=>words.has(term)))??tool.actions?.[0]??tool.name;
        return{tool,score,reasons,recommendedAction};
      })
      .filter(selection=>selection.score>0)
      .sort((a,b)=>b.score-a.score||rank[a.tool.permission]-rank[b.tool.permission]||a.tool.name.localeCompare(b.tool.name));
  }

  discover(action:string,contract:AgentContract,requiredPermission:PermissionLevel){
    return this.select(action,contract,requiredPermission)
      .filter(selection=>rank[selection.tool.permission]<=rank[requiredPermission])
      .map(selection=>({
      name:selection.tool.name,description:selection.tool.description,permission:selection.tool.permission,
      dangerous:selection.tool.dangerous,actions:[...(selection.tool.actions??[])],tags:[...(selection.tool.tags??[])],
      recommendedAction:selection.recommendedAction,score:selection.score,reasons:selection.reasons
    }));
  }
}
function terms(input:string):Set<string>{return new Set(input.toLowerCase().split(/[^\p{L}\p{N}_:-]+/u).filter(word=>word.length>2));}
