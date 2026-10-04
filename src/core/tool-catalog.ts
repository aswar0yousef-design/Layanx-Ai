import type {PermissionLevel} from "./types.js";

const PERMISSION_RANK:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};

export interface ToolCatalogEntry{
  name:string;
  description:string;
  permission:PermissionLevel;
  dangerous:boolean;
  actions:string[];
  tags:string[];
}

export interface ToolDiscoveryQuery{
  action:string;
  permission:PermissionLevel;
}

export class ToolCatalog{
  constructor(private readonly registry:import("../tools/registry.js").ToolRegistry){}

  list(contract?:import("./contracts.js").AgentContract,permission?:PermissionLevel):ToolCatalogEntry[]{
    const max=permission&&contract?Math.min(PERMISSION_RANK[permission],PERMISSION_RANK[contract.requiredPermission]):permission?PERMISSION_RANK[permission]:undefined;
    return this.registry.list()
      .filter(tool=>!contract||contract.allowedTools.includes("*")||contract.allowedTools.includes(tool.name))
      .filter(tool=>!contract||!contract.forbiddenResources.includes(tool.name))
      .filter(tool=>max===undefined||PERMISSION_RANK[tool.permission]<=max)
      .map(toPublic);
  }

  discover(query:ToolDiscoveryQuery,contract:import("./contracts.js").AgentContract):ToolCatalogEntry[]{
    const terms=query.action.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
    return this.list(contract,query.permission)
      .filter(tool=>PERMISSION_RANK[tool.permission]<=PERMISSION_RANK[query.permission])
      .map(tool=>{const haystack=[tool.name,tool.description,...tool.actions,...tool.tags].join(" ").toLowerCase();const score=terms.reduce((sum,term)=>sum+(haystack.includes(term)?1:0),0);return{tool,score};})
      .filter(item=>item.score>0 && (terms.length===1 || item.score>=2 || toolActionMatch(item.tool,terms)))
      .sort((a,b)=>b.score-a.score||a.tool.name.localeCompare(b.tool.name))
      .filter((item,index,items)=>index===0||item.score===items[0]!.score)
      .map(item=>item.tool);
  }
}
function toolActionMatch(tool:import("../tools/registry.js").ToolDefinition,terms:string[]):boolean{\n  const actions=[...(tool.actions??[])].map(action=>action.toLowerCase());\n  return terms.some(term=>actions.some(action=>action.split(/[^a-z0-9_]+/).includes(term)));\n}\nfunction toPublic(tool:import("../tools/registry.js").ToolDefinition):ToolCatalogEntry{
  return {name:tool.name,description:tool.description,permission:tool.permission,dangerous:tool.dangerous,actions:[...(tool.actions??[])],tags:[...(tool.tags??[])]};
}
