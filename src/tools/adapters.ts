import type {ToolAdapter} from "./executor.js";

export class ToolAdapterRegistry {
  private readonly adapters=new Map<string,ToolAdapter>();

  register(tool:string,adapter:ToolAdapter):void {
    if(this.adapters.has(tool)) throw new Error("Tool adapter already registered.");
    this.adapters.set(tool,adapter);
  }

  unregister(tool:string):boolean{return this.adapters.delete(tool);}

  get(tool:string):ToolAdapter {
    const adapter=this.adapters.get(tool);
    if(!adapter) throw new Error(`No adapter registered for tool: ${tool}`);
    return adapter;
  }

  has(tool:string):boolean { return this.adapters.has(tool); }
  list():string[] { return [...this.adapters.keys()]; }
}
