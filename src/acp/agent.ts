import {randomBytes} from "node:crypto";
import path from "node:path";

/**
 * Agent Client Protocol (ACP v1) agent for editors such as Zed and JetBrains IDEs.
 *
 * The editor starts this process and talks JSON-RPC over stdin/stdout. Every request is handed to the
 * LayanX that already runs on this computer (same memory, tools, trust levels and approvals): a
 * prompt becomes a mission on the project folder the editor has open, its steps stream back as
 * tool calls, and every step that needs approval becomes the editor's permission prompt.
 * "Allow always" is not offered: what runs without asking is decided on the LayanX setup page.
 * MCP servers proposed by the editor are not started (LayanX adds MCP servers only with owner approval).
 */
export const ACP_PROTOCOL_VERSION=1;
type Json=Record<string,any>;
export interface LayanxApi{request(method:"GET"|"POST",path:string,body?:unknown):Promise<{status:number;data:any}>}
interface Session{id:string;cwd:string;projectId:string;missionId?:string;cancelled:boolean;busy:boolean;cancelPending?:()=>void}
const GOAL_LIMIT=4000;

export function projectIdFor(cwd:string):string{
  const base=cwd.split(/[\\/]+/).filter(Boolean).pop()||"project";
  return base.toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,60)||"project";
}
export function toolKind(tool:string):string{
  if(/^(files\.(read|list|stat)|project\.(knowledge|code_map|inspect)|git\.(status|diff|log)|runtime\.status|mission\.inspect|desktop\.(ui\.tree|screenshot|status))$/.test(tool))return"read";
  if(/^(files\.write|project\.knowledge\.record|learning\.record)$/.test(tool))return"edit";
  if(/^(memory\.recall|project\.references|research\.internet|learning\.search|agent-reach\.collect|mcp\.registry\.search|google\.gmail\.search)$/.test(tool))return"search";
  if(/^(http\.read|browser\.read)$/.test(tool))return"fetch";
  if(/^(project\.(run|verify|bootstrap|security)|terminal\.exec|agent\.external|browser\.test|git\.\w+)$/.test(tool))return"execute";
  return"other";
}
/** Prompt blocks -> one goal text (text, linked files, embedded file contents), within the API limit. */
export function goalFromPrompt(blocks:Json[],cwd:string):string{
  const parts:string[]=[];
  for(const b of Array.isArray(blocks)?blocks:[]){
    if(b?.type==="text"&&typeof b.text==="string")parts.push(b.text);
    else if(b?.type==="resource_link"&&typeof b.uri==="string")parts.push(`[file: ${b.name??b.uri}] ${b.uri}`);
    else if(b?.type==="resource"&&b.resource&&typeof b.resource.uri==="string")parts.push(typeof b.resource.text==="string"?`File ${b.resource.uri}:\n${b.resource.text}`:`[file: ${b.resource.uri}]`);
  }
  const context=["","Editor context:",`- Project folder: ${cwd}`,"- The request came from a code editor through ACP.","- Use the existing LayanX tools, permissions and approvals; do not bypass them.","- Change only files in this project folder and verify before reporting completion."].join("\n");
  let text=parts.join("\n\n").trim();
  if(text.length+context.length>GOAL_LIMIT)text=text.slice(0,GOAL_LIMIT-context.length-30)+"\n…[trimmed]";
  return text+"\n"+context;
}
function summarize(value:unknown,max=1500):string{
  if(value===undefined||value===null)return"";
  const s=typeof value==="string"?value:JSON.stringify(value,null,1);
  return s.length>max?s.slice(0,max)+" …":s;
}

export class AcpAgent{
  private readonly sessions=new Map<string,Session>();
  private readonly waiting=new Map<string,(value:Json)=>void>();
  private seq=0;
  constructor(private readonly api:LayanxApi,private readonly send:(message:Json)=>void,private readonly opts:{version:string;pollMs?:number;maxSteps?:number;log?:(s:string)=>void}={version:"0"}){}

  /** One incoming JSON-RPC message (request, notification or a response to our own request). */
  async handle(msg:Json):Promise<void>{
    if(!msg||msg.jsonrpc!=="2.0"){this.send({jsonrpc:"2.0",id:msg?.id??null,error:{code:-32600,message:"Invalid request"}});return;}
    if(typeof msg.method!=="string"){
      const done=this.waiting.get(String(msg.id));
      if(done){this.waiting.delete(String(msg.id));done(msg.error?{outcome:{outcome:"cancelled"}}:msg.result??{});}
      return;
    }
    const isRequest=msg.id!==undefined&&msg.id!==null;
    try{
      const result=await this.dispatch(msg.method,msg.params??{});
      if(isRequest)this.send({jsonrpc:"2.0",id:msg.id,result});
    }catch(e){
      const err=e as {code?:number;message?:string};
      if(isRequest)this.send({jsonrpc:"2.0",id:msg.id,error:{code:typeof err.code==="number"?err.code:-32603,message:err.message??"Internal error"}});
      else this.opts.log?.(`notification ${msg.method} failed: ${err.message}`);
    }
  }

  private async dispatch(method:string,p:Json):Promise<unknown>{
    switch(method){
      case"initialize":return{protocolVersion:ACP_PROTOCOL_VERSION,
        agentCapabilities:{loadSession:false,promptCapabilities:{image:false,audio:false,embeddedContext:true},mcpCapabilities:{http:false,sse:false}},
        agentInfo:{name:"layanx",title:"LayanX",version:this.opts.version},authMethods:[]};
      case"authenticate":return{};
      case"session/new":return this.newSession(p);
      case"session/prompt":return this.prompt(p);
      case"session/cancel":this.cancel(String(p.sessionId??""));return undefined;
      default:
        if(method.startsWith("$/")||method.startsWith("_"))throw Object.assign(new Error("Method not found: "+method),{code:-32601});
        throw Object.assign(new Error("Method not found: "+method),{code:-32601});
    }
  }

  private async newSession(p:Json){
    const cwd=typeof p.cwd==="string"?p.cwd:"";
    if(!cwd||!(path.isAbsolute(cwd)||path.win32.isAbsolute(cwd)))throw Object.assign(new Error("cwd must be an absolute path"),{code:-32602});
    const projectId=projectIdFor(cwd);
    const linked=await this.api.request("POST","/v1/projects/link",{projectId,path:cwd});
    if(linked.status>=400)throw new Error(`LayanX could not open ${cwd}: ${linked.data?.message??linked.data?.error??"HTTP "+linked.status}`);
    const id="lx_"+randomBytes(9).toString("base64url");
    this.sessions.set(id,{id,cwd,projectId,cancelled:false,busy:false});
    if(Array.isArray(p.mcpServers)&&p.mcpServers.length)this.opts.log?.(`ignoring ${p.mcpServers.length} MCP server(s) from the editor: add them in LayanX (owner approval)`);
    return{sessionId:id};
  }

  private update(s:Session,update:Json){this.send({jsonrpc:"2.0",method:"session/update",params:{sessionId:s.id,update}});}
  private say(s:Session,text:string){if(text)this.update(s,{sessionUpdate:"agent_message_chunk",content:{type:"text",text}});}

  private cancel(sessionId:string){
    const s=this.sessions.get(sessionId);if(!s)return;
    s.cancelled=true;s.cancelPending?.();
    if(s.missionId)void this.api.request("POST",`/v1/missions/${encodeURIComponent(s.missionId)}/cancel`,{projectId:s.projectId}).catch(()=>undefined);
  }

  private askPermission(s:Session,toolCall:Json):Promise<Json>{
    const id="perm-"+(++this.seq);
    return new Promise(resolve=>{
      s.cancelPending=()=>{this.waiting.delete(id);resolve({outcome:{outcome:"cancelled"}});};
      this.waiting.set(id,v=>{s.cancelPending=undefined;resolve(v);});
      this.send({jsonrpc:"2.0",id,method:"session/request_permission",params:{sessionId:s.id,toolCall,
        options:[{optionId:"approve",name:"Approve once",kind:"allow_once"},{optionId:"decline",name:"Decline",kind:"reject_once"}]}});
    });
  }

  private async prompt(p:Json){
    const s=this.sessions.get(String(p.sessionId??""));
    if(!s)throw Object.assign(new Error("Unknown session"),{code:-32602});
    if(s.busy)throw Object.assign(new Error("A prompt is already running in this session"),{code:-32602});
    s.busy=true;s.cancelled=false;s.missionId=undefined;
    try{return await this.run(s,goalFromPrompt(p.prompt,s.cwd));}
    finally{s.busy=false;s.cancelPending=undefined;}
  }

  private async run(s:Session,goal:string):Promise<{stopReason:string}>{
    const created=await this.api.request("POST","/v1/missions",{goal,projectId:s.projectId});
    if(created.status>=400||!created.data?.mission?.id){this.say(s,`LayanX could not plan this request: ${created.data?.error??"HTTP "+created.status}`);return{stopReason:"end_turn"};}
    const mission=created.data.mission as {id:string;tools?:Array<{tool:string;action?:string;reason?:string;payload?:unknown}>;steps?:Array<{description:string}>};
    s.missionId=mission.id;
    const steps=(mission.steps??[]).filter(x=>x?.description);
    if(steps.length)this.update(s,{sessionUpdate:"plan",entries:steps.slice(0,20).map(x=>({content:x.description,priority:"medium",status:"pending"}))});
    const seen=new Set<string>();const calls=new Map<string,string>();
    const callId=(tool:string,index?:number)=>`${mission.id}:${index??tool}`;
    const events=async()=>{
      const r=await this.api.request("GET",`/v1/missions/${encodeURIComponent(mission.id)}/events?projectId=${encodeURIComponent(s.projectId)}`).catch(()=>null);
      for(const e of (r?.data?.events??[]) as Json[]){
        if(seen.has(e.id))continue;seen.add(e.id);
        if(!e.tool)continue;
        const id=callId(e.tool,e.stepIndex);
        if(!calls.has(id)&&/^tool\.(selected|started|completed|failed)$/.test(e.type)){
          calls.set(id,e.tool);
          this.update(s,{sessionUpdate:"tool_call",toolCallId:id,title:`${e.tool}${e.action&&e.action!==e.tool?` (${e.action})`:""}`,kind:toolKind(e.tool),status:"in_progress"});
        }
        if(e.type==="tool.completed")this.update(s,{sessionUpdate:"tool_call_update",toolCallId:id,status:"completed"});
        if(e.type==="tool.failed")this.update(s,{sessionUpdate:"tool_call_update",toolCallId:id,status:"failed",...(e.message?{content:[{type:"content",content:{type:"text",text:String(e.message)}}]}:{})});
      }
    };
    const approvals:Record<number,string>={};
    for(let round=0;round<30;round++){
      const loop=this.api.request("POST",`/v1/missions/${encodeURIComponent(mission.id)}/agent-loop`,{projectId:s.projectId,maxSteps:this.opts.maxSteps??10,agentId:"core",approvalIds:approvals});
      let settled:{status:number;data:any}|null=null;
      loop.then(v=>{settled=v;},e=>{settled={status:599,data:{error:String(e instanceof Error?e.message:e)}};});
      while(!settled){await events();if(s.cancelled)break;await new Promise(r=>setTimeout(r,this.opts.pollMs??700));}
      if(s.cancelled){await events();return{stopReason:"cancelled"};}
      await events();
      const result=(settled as unknown as {status:number;data:any}).data??{};
      if(result.paused&&result.approvalId&&Number.isInteger(result.nextToolIndex)){
        const index=result.nextToolIndex as number;
        const fresh=await this.api.request("GET",`/v1/missions/${encodeURIComponent(mission.id)}?projectId=${encodeURIComponent(s.projectId)}`).catch(()=>null);
        const planned=(fresh?.data?.mission?.tools??mission.tools??[])[index]??{tool:"step "+(index+1)};
        const id=callId(planned.tool,index);
        const toolCall={toolCallId:id,title:`${planned.tool}${planned.action?` (${planned.action})`:""}${planned.reason?`: ${planned.reason}`:""}`,kind:toolKind(planned.tool),status:"pending",rawInput:planned.payload??{}};
        if(!calls.has(id)){calls.set(id,planned.tool);this.update(s,{sessionUpdate:"tool_call",...toolCall});}
        const answer=await this.askPermission(s,toolCall);
        if(s.cancelled||answer?.outcome?.outcome!=="selected"){await this.api.request("POST",`/v1/approvals/${encodeURIComponent(result.approvalId)}/revoke?projectId=${encodeURIComponent(s.projectId)}`,{}).catch(()=>undefined);return{stopReason:"cancelled"};}
        if(answer.outcome.optionId!=="approve"){
          await this.api.request("POST",`/v1/approvals/${encodeURIComponent(result.approvalId)}/revoke?projectId=${encodeURIComponent(s.projectId)}`,{}).catch(()=>undefined);
          this.update(s,{sessionUpdate:"tool_call_update",toolCallId:id,status:"failed",content:[{type:"content",content:{type:"text",text:"Declined in the editor."}}]});
          this.say(s,`Stopped before ${planned.tool}: you declined it.`);
          return{stopReason:"end_turn"};
        }
        const granted=await this.api.request("POST",`/v1/approvals/${encodeURIComponent(result.approvalId)}/approve?projectId=${encodeURIComponent(s.projectId)}`,{});
        if(granted.status>=400){this.say(s,`LayanX did not accept the approval: ${granted.data?.error??granted.status}`);return{stopReason:"end_turn"};}
        approvals[index]=result.approvalId;
        continue;
      }
      if(result.completed){
        const final=result.final?.data??result.results?.at?.(-1)?.data;
        this.say(s,`Done.${final?`\n\n${summarize(final)}`:""}`);
      }else this.say(s,`LayanX stopped: ${result.reason??result.error??result.status??"the mission did not complete"}`);
      return{stopReason:"end_turn"};
    }
    this.say(s,"Stopped after too many approval rounds.");
    return{stopReason:"max_turn_requests"};
  }
}

/** Newline-delimited JSON-RPC over two streams (stdin/stdout of the editor's child process). */
export function serveAcp(agent:(send:(m:Json)=>void)=>AcpAgent,input:NodeJS.ReadableStream,output:NodeJS.WritableStream):Promise<void>{
  const write=(m:Json)=>{output.write(JSON.stringify(m)+"\n");};
  const a=agent(write);
  let buffer="";
  return new Promise(resolve=>{
    input.setEncoding?.("utf8");
    input.on("data",(chunk:string)=>{
      buffer+=chunk;let i:number;
      while((i=buffer.indexOf("\n"))>=0){
        const line=buffer.slice(0,i).trim();buffer=buffer.slice(i+1);
        if(!line)continue;
        let msg:Json;
        try{msg=JSON.parse(line);}catch{write({jsonrpc:"2.0",id:null,error:{code:-32700,message:"Parse error"}});continue;}
        void a.handle(msg);
      }
    });
    input.on("end",()=>resolve());
  });
}
