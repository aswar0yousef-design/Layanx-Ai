import type {LayanXCore} from "./core/orchestrator.js";
import type {PermissionLevel} from "./core/types.js";
import {LEGACY_VERSIONS} from "./mcp/client.js";

interface RpcRequest{id?:string|number;method:string;params?:Record<string,unknown>}
interface RpcResponse{id?:string|number;result?:unknown;error?:{code:number;message:string;data?:unknown}}

function response(id:string|number|undefined,result:unknown):RpcResponse{return{id,result};}
function error(id:string|number|undefined,code:number,message:string,data?:unknown):RpcResponse{return{id,error:{code,message,data}};}

export class McpGateway{
 constructor(private readonly core:LayanXCore){
  if(!core.tools.list().some(tool=>tool.name==="runtime.status")){
   this.core.tools.register({name:"runtime.status",description:"read runtime status, configured providers, and registered models",permission:"L1_READ",dangerous:false,actions:["read runtime status","runtime status"],tags:["runtime","status","health"]});
   const core=this.core;this.core.toolAdapters.register("runtime.status",{async execute(){return{system:"LayanX AI",ready:core.isReady(),agents:core.agents.list().map(agent=>agent.agentId),providers:core.providers.list().map(provider=>provider.name),models:core.models.list().map(model=>({id:model.id,provider:model.provider,local:model.local,enabled:model.enabled,priority:model.priority}))};}});
  }
 }
 async handle(input:unknown):Promise<RpcResponse|undefined>{
  if(!input||typeof input!=="object"||Array.isArray(input))return error(undefined,-32600,"Invalid Request.");
  const request=input as RpcRequest;
  if(typeof request.method!=="string")return error(request.id,-32600,"Invalid Request.");
  if(request.method==="notifications/initialized")return undefined;
  if(request.method==="ping")return response(request.id,{});
  if(request.method==="initialize"){
   // Legacy (initialize-based) MCP: answer with the client's version when we speak it, otherwise our newest.
   // Modern 2026-07-28 clients probe with server/discover first; the "method not found" below makes them fall back here.
   const requested=typeof request.params?.protocolVersion==="string"?request.params.protocolVersion:"";
   return response(request.id,{
    protocolVersion:(LEGACY_VERSIONS as readonly string[]).includes(requested)?requested:LEGACY_VERSIONS[0],
    capabilities:{tools:{}},
    serverInfo:{name:"LayanX AI MCP Gateway",version:"0.1.0"}
   });
  }
  if(request.method==="tools/list"){
   const contract=this.core.agents.get("core");
   const tools=this.core.toolCatalog.list(contract,"L1_READ").map(tool=>({
    name:tool.name,description:tool.description,inputSchema:{type:"object",additionalProperties:true}
   }));
   return response(request.id,{tools});
  }
  if(request.method==="tools/call"){
   const params=request.params??{};
   const name=typeof params.name==="string"?params.name.trim():"";
   const args=params.arguments&&typeof params.arguments==="object"&&!Array.isArray(params.arguments)?params.arguments as Record<string,unknown>:{};
   const missionId=typeof args.missionId==="string"?args.missionId.trim():"";
   const projectId=typeof args.projectId==="string"?args.projectId.trim():"";
   const toolIndex=typeof args.toolIndex==="number"&&Number.isInteger(args.toolIndex)?args.toolIndex:-1;
   if(!name||!missionId||!projectId||toolIndex<0)return error(request.id,-32602,"name, missionId, projectId, and non-negative toolIndex are required.");
   const mission=this.core.missions.get(missionId);
   if(!mission)return error(request.id,-32004,"Mission not found.");
   const plan=mission.tools?.[toolIndex];
   if(!plan||plan.tool!==name)return error(request.id,-32602,"MCP tool call must match the mission tool plan.");
   try{
    const result=await this.core.executeMissionTool(
     missionId,projectId,toolIndex,args.payload??plan.payload??{},
     typeof args.approvalId==="string"?args.approvalId:undefined,"core"
    );
    return response(request.id,{content:[{type:"text",text:JSON.stringify(result)}],isError:!result.ok});
   }catch(cause){
    return error(request.id,-32000,cause instanceof Error?cause.message:"MCP tool execution failed.");
   }
  }
  return error(request.id,-32601,"Method not found.");
 }
}
