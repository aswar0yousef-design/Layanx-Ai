import type {PermissionLevel} from "./types.js";

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
    const rank:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};
    const max=permission&&contract?Math.min(rank[permission],rank[contract.requiredPermission]):permission?rank[permission]:undefined;
    return this.registry.list()
      .filter(tool=>!contract||contract.allowedTools.includes(tool.name))
      .filter(tool=>!contract||!contract.forbiddenResources.includes(tool.name))
      .filter(tool=>max===undefined||rank[tool.permission]<=max)
      .map(toPublic);
  }

  discover(query:ToolDiscoveryQuery,contract:import("./contracts.js").AgentContract):ToolCatalogEntry[]{
    return this.list(contract,query.permission);
  }
}
function toPublic(tool:import("../tools/registry.js").ToolDefinition):ToolCatalogEntry{
  return {name:tool.name,description:tool.description,permission:tool.permission,dangerous:tool.dangerous,actions:[...(tool.actions??[])],tags:[...(tool.tags??[])]};
}
