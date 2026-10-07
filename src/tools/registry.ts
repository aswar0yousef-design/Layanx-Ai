export type PermissionLevel="L1_READ"|"L2_ANALYZE"|"L3_MODIFY"|"L4_EXECUTE"|"L5_CRITICAL";

export interface ToolDefinition {
  name:string;
  description:string;
  permission:PermissionLevel;
  dangerous:boolean;
  actions?:string[];
  tags?:string[];
}

export class ToolRegistry {
  private readonly tools=new Map<string,ToolDefinition>();
  register(tool:ToolDefinition&{action?:string}):void {
    if(this.tools.has(tool.name)) throw new Error("Tool already registered.");
    // Several built-in tools declare a single `action`. Fold it into `actions`: the planner, the
    // catalog and the request builder only look at `actions`, so those tools (all Git and desktop
    // control tools) could never be chosen by the agent.
    const actions=[...(tool.actions??[]),...(tool.action&&!(tool.actions??[]).includes(tool.action)?[tool.action]:[])];
    this.tools.set(tool.name,{...tool,actions:actions.length?actions.map(normalize):undefined,tags:tool.tags?.map(normalize)});
  }
  get(name:string):ToolDefinition {
    const tool=this.tools.get(name);
    if(!tool) throw new Error(`Unknown tool: ${name}`);
    return structuredClone(tool);
  }
  list():ToolDefinition[]{return [...this.tools.values()].map(tool=>structuredClone(tool));}
}
function normalize(value:string):string{return value.trim().toLowerCase();}
