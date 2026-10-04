import type {LayanXCore} from "../core/orchestrator.js";
import type {FlowDefinition,FlowContext,FlowEvent,FlowExecution,FlowNode} from "./types.js";
import {FlowStore} from "./store.js";

function id(){return crypto.randomUUID();}
function template(value:string,ctx:FlowContext){return value.replace(/\{\{\s*([^}]+?)\s*\}\}/g,(_,path:string)=>{const parts=path.split(".").map(x=>x.trim());let cur:unknown=ctx;for(const p of parts){if(cur&&typeof cur==="object"&&p in (cur as Record<string,unknown>))cur=(cur as Record<string,unknown>)[p];else return "";}return typeof cur==="string"?cur:JSON.stringify(cur??"");});}
function resolve(value:unknown,ctx:FlowContext):unknown{if(typeof value==="string")return template(value,ctx);if(Array.isArray(value))return value.map(v=>resolve(v,ctx));if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([k,v])=>[k,resolve(v,ctx)]));return value;}
function truthy(v:unknown){return !(v===false||v===null||v===undefined||v===""||v===0);}
function condition(expr:string,ctx:FlowContext){const m=expr.trim().match(/^(.+?)\s*(===|!==|==|!=|contains|startsWith|truthy)\s*(.*?)\s*$/);if(!m)return truthy(resolve(expr.trim(),ctx));const left=resolve(m[1]!.trim(),ctx);const op=m[2]!;const rawRight=m[3]!.trim();const unquoted=rawRight.replace(/^["']|["']$/g,"");const right=(rawRight!==unquoted)?unquoted:(unquoted in ctx?resolve(unquoted,ctx):unquoted);if(op==="truthy")return truthy(left);if(op==="contains")return String(left??"").includes(String(right??""));if(op==="startsWith")return String(left??"").startsWith(String(right??""));if(op==="==="||op==="==")return String(left)===String(right);return String(left)!==String(right);}

export class FlowRuntime{
 constructor(private readonly core:LayanXCore,private readonly sendMessage?: (channel:string,chatId:string,text:string)=>Promise<void>,private readonly store=new FlowStore()){}
 getStore(){return this.store;}
 validate(flow:FlowDefinition){
  if(!flow.id||!flow.projectId||!flow.name)throw new Error("flow id, projectId and name are required");
  if(!flow.nodes.length)throw new Error("flow must contain at least one node");
  const ids=new Set<string>();for(const n of flow.nodes){if(ids.has(n.id))throw new Error("duplicate node id: "+n.id);ids.add(n.id);}
  for(const e of flow.edges){if(!ids.has(e.source)||!ids.has(e.target))throw new Error("edge references unknown node");}
  const outgoing=new Map<string,FlowNode[]>();for(const n of flow.nodes)outgoing.set(n.id,[]);
  for(const e of flow.edges)outgoing.get(e.source)!.push(flow.nodes.find(n=>n.id===e.target)!);
  const visiting=new Set<string>(),visited=new Set<string>();
  const walk=(node:string)=>{if(visiting.has(node))throw new Error("flow cycle detected");if(visited.has(node))return;visiting.add(node);for(const next of outgoing.get(node)??[])walk(next.id);visiting.delete(node);visited.add(node);};
  walk(flow.nodes[0]!.id);
  return flow;
 }
 async handleInbound(event:FlowEvent){const flows=await this.store.listFlows(event.projectId);const triggerType=String(event.metadata?.eventType??"message");const candidates=flows.filter(f=>f.status==="active"&&f.nodes.some(n=>n.type==="trigger"&&(n.config.eventType===triggerType||n.config.eventType==="*")));const results=[];for(const flow of candidates)results.push(await this.execute(flow,event));return{matched:candidates.length,results};}
 async execute(flow:FlowDefinition,event:FlowEvent):Promise<FlowExecution>{
  this.validate(flow);if(flow.status!=="active")throw new Error("flow is not active");
  this.core.projectIsolation.normalize(event.projectId);
  if(flow.projectId!==event.projectId)throw new Error("Flow project isolation violation.");
  const execution:FlowExecution={id:id(),flowId:flow.id,projectId:flow.projectId,eventId:event.id,status:"running",startedAt:new Date().toISOString(),outputs:{},trace:[]};
  const ctx:FlowContext={event,variables:{},outputs:execution.outputs,execution};
  let current=flow.nodes.find(n=>n.type==="trigger")??flow.nodes[0]!;
  const visited=new Set<string>();
  try{
   for(let steps=0;steps<flow.nodes.length*3;steps++){
    if(visited.has(current.id))throw new Error("flow revisited a node; possible cycle");
    visited.add(current.id);execution.currentNodeId=current.id;execution.trace.push(current.id);await this.store.saveExecution(execution);
    const out=await this.runNode(current,ctx);execution.outputs[current.id]=out;
    if(current.type==="handoff"){execution.status="paused";execution.handoff=out as FlowExecution["handoff"];execution.endedAt=new Date().toISOString();await this.store.saveExecution(execution);return execution;}
    if(current.type==="end"){execution.status="completed";execution.endedAt=new Date().toISOString();await this.store.saveExecution(execution);return execution;}
    const edges=flow.edges.filter(e=>e.source===current.id);
    let edge=edges.find(e=>!e.condition||condition(e.condition,ctx));
    if(!edge&&current.type==="condition")edge=edges.find(e=>e.label?.toLowerCase()==="false");
    if(!edge)throw new Error("No outgoing edge matched from node "+current.id);
    current=flow.nodes.find(n=>n.id===edge!.target)!;
   }
   throw new Error("flow step limit exceeded");
  }catch(error){execution.status="failed";execution.error=error instanceof Error?error.message:String(error);execution.endedAt=new Date().toISOString();await this.store.saveExecution(execution);return execution;}
 }
 private async runNode(node:FlowNode,ctx:FlowContext):Promise<unknown>{
  const c=node.config;
  switch(node.type){
   case "trigger": return{received:true,channel:ctx.event.channel,text:ctx.event.text};
   case "condition": return{matched:condition(String(c.expression??"truthy"),ctx)};
   case "ai_agent":{
    const goal=String(resolve(c.goal??"Respond to the incoming message.",ctx));
    const projectId=ctx.event.projectId;
    const agentId=typeof c.agentId==="string"&&c.agentId?c.agentId:"core";
    const result=await this.core.runAgentGateway(goal,projectId,typeof c.maxSteps==="number"?Math.min(Math.max(c.maxSteps,1),25):8,{},agentId,{preferLocal:true});
    if(result.paused)return{status:"awaiting_approval",result};
    if(!result.completed)throw new Error(result.reason??"AI agent node failed");
    const finalData=((result as {final?:{data?:unknown}}).final)?.data;
    const lastData=(result.results?.at(-1) as {data?:unknown}|undefined)?.data;
    const text=typeof finalData==="string"?finalData:typeof lastData==="string"?lastData:undefined;
    return{text,status:"completed",result};
   }
   case "tool":{
    const goal=String(resolve(c.goal??c.action??"",ctx));if(!goal)throw new Error("tool node requires goal");
    const result=await this.core.runAgentGateway(goal,ctx.event.projectId,typeof c.maxSteps==="number"?Math.min(Math.max(c.maxSteps,1),25):6,{},typeof c.agentId==="string"&&c.agentId?c.agentId:"core",{preferLocal:true});
    if(!result.completed)throw new Error(result.reason??"tool node failed");
    return result;
   }
   case "message":{const text=String(resolve(c.text??"",ctx));if(this.sendMessage)await this.sendMessage(ctx.event.channel,ctx.event.chatId,text);return{channel:ctx.event.channel,chatId:ctx.event.chatId,text,sent:Boolean(this.sendMessage)};}
   case "crm_upsert":{
    const customerId=String(resolve(c.customerId??ctx.event.senderId,ctx));
    const key="crm:"+ctx.event.projectId+":"+customerId;
    const existing=this.core.memory.recall(customerId,20,ctx.event.projectId);
    this.core.memory.remember({missionId:"flow:"+ctx.execution.id,projectId:ctx.event.projectId,kind:"fact",summary:"CRM flow profile "+customerId,content:{key,customerId,data:resolve(c.data??{},ctx)},confidence:1,tags:["flow","crm",customerId]});
    return{customerId,stored:true,previousContext:existing};
   }
   case "handoff": return{queue:String(resolve(c.queue??"human-agent",ctx)),reason:String(resolve(c.reason??"Human handoff requested.",ctx))};
   case "end": return{done:true};
  }
 }
}
