import type {LayanXCore} from "../core/orchestrator.js";
import {searchRegistry,type McpManager} from "./manager.js";

/**
 * Agent-facing MCP tools. The agent can search the MCP Registry for a capability it lacks and
 * *request* a server; only the owner can approve it (Control Center -> Integrations -> MCP).
 */
export function registerMcpTools(core:LayanXCore,manager:McpManager,options:{fetcher?:typeof fetch}={}):void{
  core.tools.register({name:"mcp.registry.search",description:"search the official MCP Registry for tool servers that add a capability LayanX lacks (e.g. 'postgres', 'figma', 'jira'). Returns pinned install suggestions; adding one needs mcp.server.request and the owner's approval.",
    permission:"L1_READ",dangerous:false,actions:["search mcp registry","find tool server","البحث عن أداة MCP"],tags:["mcp","registry","skills","tools","search","مهارات","أدوات"]});
  core.toolAdapters.register("mcp.registry.search",{async execute(request){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const query=typeof input.query==="string"?input.query:"";
    return{results:await searchRegistry(query,{...(options.fetcher?{fetcher:options.fetcher}:{}),limit:10})};
  }});
  core.tools.register({name:"mcp.servers.list",description:"list the MCP tool servers configured in LayanX, whether the owner approved them, and the tools each one provides",
    permission:"L1_READ",dangerous:false,actions:["list mcp servers","قائمة خوادم MCP"],tags:["mcp","servers","tools","integrations"]});
  core.toolAdapters.register("mcp.servers.list",{async execute(){return{servers:manager.list().map(s=>({id:s.id,name:s.name,approved:s.approved,enabled:s.enabled,connected:s.connected,tools:s.tools,error:s.error}))};}});
  core.tools.register({name:"mcp.server.request",description:"ask the owner to add an MCP tool server: payload {registryName} from mcp.registry.search (or {config}) plus {reason}. It stays disabled until the owner approves it on this computer.",
    permission:"L3_MODIFY",dangerous:false,actions:["request mcp server","طلب أداة MCP"],tags:["mcp","request","install","skills","مهارات"]});
  core.toolAdapters.register("mcp.server.request",{async execute(request){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const reason=typeof input.reason==="string"?input.reason.slice(0,300):"";
    let config:Record<string,unknown>|undefined=input.config&&typeof input.config==="object"?{...input.config as Record<string,unknown>}:undefined;
    if(!config&&typeof input.registryName==="string"){
      const hit=(await searchRegistry(input.registryName,{...(options.fetcher?{fetcher:options.fetcher}:{}),limit:20})).find(r=>r.name===input.registryName);
      if(!hit?.suggested)throw new Error("No installable server named "+input.registryName+" in the MCP Registry.");
      config={...hit.suggested};
    }
    if(!config)throw new Error("registryName or config is required.");
    const added=manager.add({...config,requestedBy:request.agentId??"agent",note:reason});
    return{requested:added.id,status:"waiting for the owner's approval in Control Center -> Integrations -> MCP",secretsNeeded:added.envFromSecrets??[]};
  }});
}
