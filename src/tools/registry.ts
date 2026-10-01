export interface ToolDefinition {
  name:string;
  description:string;
  permission:"L1_READ"|"L2_ANALYZE"|"L3_MODIFY"|"L4_EXECUTE"|"L5_CRITICAL";
  dangerous:boolean;
}

export class ToolRegistry {
  private readonly tools=new Map<string,ToolDefinition>();

  register(tool:ToolDefinition):void {
    if(this.tools.has(tool.name)) throw new Error("Tool already registered.");
    this.tools.set(tool.name,tool);
  }

  get(name:string):ToolDefinition {
    const tool=this.tools.get(name);
    if(!tool) throw new Error(`Unknown tool: ${name}`);
    return tool;
  }

  list():ToolDefinition[]{return [...this.tools.values()];}
}
