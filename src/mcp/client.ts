import {spawn,type ChildProcessWithoutNullStreams} from "node:child_process";
import {createInterface} from "node:readline";

/**
 * Model Context Protocol client, dual-era:
 *  - modern (2026-07-28): stateless requests carrying `_meta` (protocol version, client info);
 *    era detected with `server/discover`, as the spec requires;
 *  - legacy (2025-11-25 .. 2024-11-05): `initialize` handshake, then requests.
 * Transports: stdio (newline-delimited JSON-RPC) and Streamable HTTP (JSON or SSE replies).
 * Server-to-client requests (sampling, elicitation, roots) are declined: LayanX never lets a
 * tool server drive its models or read its files.
 */
export const MODERN_VERSION="2026-07-28";
export const LEGACY_VERSIONS=["2025-11-25","2025-06-18","2025-03-26","2024-11-05"] as const;
const CLIENT_INFO={name:"LayanX",version:"0.9.0"};
const MODERN_ERROR_CODES=new Set([-32022,-32020,-32021,-32023]);

export interface McpTool{name:string;description?:string;inputSchema?:Record<string,unknown>;annotations?:Record<string,unknown>}
export interface McpCallResult{text:string;isError:boolean;structured?:unknown;images:Array<{mimeType:string;base64:string}>}
interface RpcMessage{jsonrpc?:string;id?:string|number|null;method?:string;params?:Record<string,unknown>;result?:unknown;error?:{code:number;message:string;data?:unknown}}

export class McpError extends Error{constructor(message:string,readonly code?:number,readonly data?:unknown){super(message);this.name="McpError";}}

interface Transport{
  request(message:RpcMessage,timeoutMs:number,headers?:Record<string,string>):Promise<RpcMessage>;
  notify(message:RpcMessage,headers?:Record<string,string>):Promise<void>;
  close():Promise<void>;
  readonly kind:"stdio"|"http";
}

export interface StdioOptions{command:string;args:string[];env:NodeJS.ProcessEnv;cwd?:string}
class StdioTransport implements Transport{
  readonly kind="stdio" as const;
  private child:ChildProcessWithoutNullStreams;
  private readonly pending=new Map<string,{resolve:(m:RpcMessage)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
  private stderr="";
  private exited=false;
  constructor(options:StdioOptions){
    this.child=spawn(options.command,options.args,{shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"],env:options.env,...(options.cwd?{cwd:options.cwd}:{})});
    this.child.stdin.on("error",()=>undefined);
    this.child.stderr.setEncoding("utf8").on("data",(c:string)=>{this.stderr=(this.stderr+c).slice(-4000);});
    createInterface({input:this.child.stdout}).on("line",line=>this.onLine(line));
    const fail=(why:string)=>{this.exited=true;for(const [id,p] of this.pending){clearTimeout(p.timer);p.reject(new McpError(why+(this.stderr?": "+this.stderr.slice(-400):"")));this.pending.delete(id);}};
    this.child.on("exit",code=>fail("MCP server exited (code "+code+")"));
    this.child.on("error",error=>fail("MCP server could not start: "+error.message));
  }
  private onLine(line:string){
    let msg:RpcMessage;try{msg=JSON.parse(line) as RpcMessage;}catch{return;}
    if(msg.method&&msg.id!==undefined&&msg.id!==null){
      // A legacy server asking us something (roots, sampling, elicitation): answer ping, decline the rest.
      const reply=msg.method==="ping"?{jsonrpc:"2.0",id:msg.id,result:{}}:{jsonrpc:"2.0",id:msg.id,error:{code:-32601,message:"LayanX does not support "+msg.method}};
      this.child.stdin.write(JSON.stringify(reply)+"\n");
      return;
    }
    if(msg.id===undefined||msg.id===null)return; // notifications (progress, logging, list_changed)
    const p=this.pending.get(String(msg.id));if(!p)return;
    this.pending.delete(String(msg.id));clearTimeout(p.timer);p.resolve(msg);
  }
  request(message:RpcMessage,timeoutMs:number):Promise<RpcMessage>{
    if(this.exited)return Promise.reject(new McpError("MCP server is not running"+(this.stderr?": "+this.stderr.slice(-400):"")));
    return new Promise((resolve,reject)=>{
      const id=String(message.id);
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new McpError("MCP request timed out: "+message.method));},timeoutMs);
      this.pending.set(id,{resolve,reject,timer});
      this.child.stdin.write(JSON.stringify(message)+"\n");
    });
  }
  async notify(message:RpcMessage){if(!this.exited)this.child.stdin.write(JSON.stringify(message)+"\n");}
  stderrTail(){return this.stderr;}
  /** Synchronous kill for process exit: on Windows children otherwise outlive LayanX. */
  kill(){if(!this.exited){try{this.child.kill();}catch{}}}
  async close(){
    if(this.exited)return;
    try{this.child.stdin.end();}catch{}
    await new Promise<void>(resolve=>{const t=setTimeout(()=>{try{this.child.kill();}catch{}resolve();},2000);this.child.once("exit",()=>{clearTimeout(t);resolve();});});
  }
}

export interface HttpOptions{url:string;headers?:Record<string,string>;fetcher?:typeof fetch}
/** Header values must be visible ASCII; anything else uses the spec's base64 sentinel. */
export function headerValue(value:string):string{
  const plain=/^[\x21-\x7E]([\x20-\x7E]*[\x21-\x7E])?$/.test(value)&&!(value.startsWith("=?base64?")&&value.endsWith("?="));
  return plain?value:"=?base64?"+Buffer.from(value,"utf8").toString("base64")+"?=";
}
class HttpTransport implements Transport{
  readonly kind="http" as const;
  private sessionId:string|undefined;
  private readonly fetcher:typeof fetch;
  constructor(private readonly options:HttpOptions){
    const u=new URL(options.url);
    if(u.protocol!=="https:"&&!(u.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(u.hostname)))throw new McpError("Remote MCP servers must use https (plain http only on this computer).");
    this.fetcher=options.fetcher??fetch;
  }
  private async post(message:RpcMessage,timeoutMs:number,headers:Record<string,string>={}):Promise<{status:number;body:RpcMessage|null}>{
    const response=await this.fetcher(this.options.url,{method:"POST",redirect:"error",signal:AbortSignal.timeout(timeoutMs),
      headers:{"content-type":"application/json","accept":"application/json, text/event-stream",...(this.options.headers??{}),...(this.sessionId?{"mcp-session-id":this.sessionId}:{}),...headers},
      body:JSON.stringify(message)});
    const session=response.headers.get("mcp-session-id");if(session)this.sessionId=session;
    if(response.status===202)return{status:202,body:null};
    const type=response.headers.get("content-type")??"";
    const text=await response.text();
    if(type.includes("text/event-stream")){
      // SSE: the final JSON-RPC response for our id ends the stream; notifications before it are skipped.
      for(const block of text.split(/\r?\n\r?\n/)){
        const data=block.split(/\r?\n/).filter(l=>l.startsWith("data:")).map(l=>l.slice(5).replace(/^ /,"")).join("\n");
        if(!data)continue;
        try{const msg=JSON.parse(data) as RpcMessage;if(msg.id!==undefined&&String(msg.id)===String(message.id))return{status:response.status,body:msg};}catch{}
      }
      return{status:response.status,body:null};
    }
    let body:RpcMessage|null=null;try{body=text?JSON.parse(text) as RpcMessage:null;}catch{}
    return{status:response.status,body};
  }
  async request(message:RpcMessage,timeoutMs:number,headers?:Record<string,string>):Promise<RpcMessage>{
    const r=await this.post(message,timeoutMs,headers);
    if(r.body&&(r.body.result!==undefined||r.body.error))return r.body;
    throw new McpError("MCP server returned HTTP "+r.status+" without a JSON-RPC response",r.status);
  }
  async notify(message:RpcMessage,headers?:Record<string,string>){await this.post(message,15_000,headers).catch(()=>undefined);}
  async close(){
    if(this.sessionId)await this.fetcher(this.options.url,{method:"DELETE",headers:{"mcp-session-id":this.sessionId},signal:AbortSignal.timeout(3000)}).catch(()=>undefined);
  }
}

export type McpEndpoint={transport:"stdio";stdio:StdioOptions}|{transport:"http";http:HttpOptions};

export class McpClient{
  private transport:Transport|null=null;
  private nextId=1;
  era:"modern"|"legacy"|null=null;
  protocolVersion:string|null=null;
  serverInfo:{name?:string;version?:string}={};
  instructions="";
  constructor(private readonly endpoint:McpEndpoint,private readonly timeoutMs=30_000){}

  private meta(){return{"io.modelcontextprotocol/protocolVersion":MODERN_VERSION,"io.modelcontextprotocol/clientInfo":CLIENT_INFO,"io.modelcontextprotocol/clientCapabilities":{}};}
  private headersFor(method:string,params:Record<string,unknown>):Record<string,string>{
    if(this.transport?.kind!=="http"||!this.protocolVersion)return{};
    const h:Record<string,string>={"mcp-protocol-version":this.protocolVersion};
    if(this.era==="modern"){h["mcp-method"]=method;const name=typeof params.name==="string"?params.name:typeof params.uri==="string"?params.uri:undefined;if(name!==undefined)h["mcp-name"]=headerValue(name);}
    return h;
  }
  private async raw(method:string,params:Record<string,unknown>,timeoutMs=this.timeoutMs,headers?:Record<string,string>):Promise<RpcMessage>{
    if(!this.transport)throw new McpError("MCP client is not connected.");
    return this.transport.request({jsonrpc:"2.0",id:this.nextId++,method,params},timeoutMs,headers??this.headersFor(method,params));
  }
  private async call(method:string,params:Record<string,unknown>={},timeoutMs=this.timeoutMs):Promise<Record<string,unknown>>{
    const full=this.era==="modern"?{...params,_meta:this.meta()}:params;
    const msg=await this.raw(method,full,timeoutMs);
    if(msg.error)throw new McpError(msg.error.message,msg.error.code,msg.error.data);
    const result=(msg.result??{}) as Record<string,unknown>;
    if(result.resultType==="input_required")throw new McpError("The MCP server asked for interactive input (sampling/elicitation), which LayanX does not provide.");
    return result;
  }

  async connect():Promise<void>{
    this.transport=this.endpoint.transport==="stdio"?new StdioTransport(this.endpoint.stdio):new HttpTransport(this.endpoint.http);
    // 1. Modern probe: server/discover with our modern version in _meta.
    let legacy=false;
    try{
      const headers=this.transport.kind==="http"?{"mcp-protocol-version":MODERN_VERSION,"mcp-method":"server/discover"}:undefined;
      const msg=await this.raw("server/discover",{_meta:this.meta()},this.transport.kind==="stdio"?5000:this.timeoutMs,headers);
      if(msg.result&&Array.isArray((msg.result as Record<string,unknown>).supportedVersions)){
        const result=msg.result as {supportedVersions:string[];_meta?:Record<string,unknown>;instructions?:string};
        if(!result.supportedVersions.includes(MODERN_VERSION))legacy=true;
        else{this.era="modern";this.protocolVersion=MODERN_VERSION;this.serverInfo=(result._meta?.["io.modelcontextprotocol/serverInfo"] as {name?:string;version?:string})??{};this.instructions=String(result.instructions??"");return;}
      }else if(msg.error&&MODERN_ERROR_CODES.has(msg.error.code)){
        const supported=((msg.error.data as {supported?:unknown})?.supported);
        const list=Array.isArray(supported)?supported.map(String):[];
        if(!list.some(v=>(LEGACY_VERSIONS as readonly string[]).includes(v)))throw new McpError("The MCP server only supports protocol versions "+list.join(", ")+"; LayanX speaks "+[MODERN_VERSION,...LEGACY_VERSIONS].join(", ")+".");
        legacy=true;
      }else legacy=true;
    }catch(error){
      if(error instanceof McpError&&/only supports protocol versions|not running|could not start|exited/.test(error.message))throw error;
      legacy=true; // timeout, HTTP 4xx without a modern error, unknown method: a legacy server
    }
    if(!legacy)return;
    // 2. Legacy handshake.
    this.era="legacy";
    const init=await this.raw("initialize",{protocolVersion:LEGACY_VERSIONS[0],capabilities:{},clientInfo:CLIENT_INFO},this.timeoutMs,{});
    if(init.error)throw new McpError("MCP initialize failed: "+init.error.message,init.error.code);
    const result=(init.result??{}) as {protocolVersion?:string;serverInfo?:{name?:string;version?:string};instructions?:string};
    if(!result.protocolVersion||!(LEGACY_VERSIONS as readonly string[]).includes(result.protocolVersion))throw new McpError("Unsupported MCP protocol version from server: "+String(result.protocolVersion));
    this.protocolVersion=result.protocolVersion;this.serverInfo=result.serverInfo??{};this.instructions=String(result.instructions??"");
    await this.transport.notify({jsonrpc:"2.0",method:"notifications/initialized"},this.headersFor("notifications/initialized",{}));
  }

  async listTools(maxPages=10):Promise<McpTool[]>{
    const tools:McpTool[]=[];let cursor:string|undefined;
    for(let page=0;page<maxPages;page++){
      const r=await this.call("tools/list",cursor?{cursor}:{});
      for(const t of Array.isArray(r.tools)?r.tools as McpTool[]:[])if(t&&typeof t.name==="string")tools.push(t);
      cursor=typeof r.nextCursor==="string"&&r.nextCursor?r.nextCursor:undefined;
      if(!cursor)break;
    }
    return tools;
  }

  async callTool(name:string,args:Record<string,unknown>,timeoutMs=120_000):Promise<McpCallResult>{
    const r=await this.call("tools/call",{name,arguments:args},timeoutMs);
    const content=Array.isArray(r.content)?r.content as Array<Record<string,unknown>>:[];
    const texts:string[]=[];const images:McpCallResult["images"]=[];
    for(const item of content){
      if(item.type==="text"&&typeof item.text==="string")texts.push(item.text);
      else if(item.type==="image"&&typeof item.data==="string"&&typeof item.mimeType==="string"&&item.data.length<2_000_000)images.push({mimeType:item.mimeType,base64:item.data});
      else if(item.type==="resource"&&item.resource&&typeof (item.resource as Record<string,unknown>).text==="string")texts.push(String((item.resource as Record<string,unknown>).text));
      else if(item.type==="resource_link"&&typeof item.uri==="string")texts.push("[resource] "+item.uri);
    }
    return{text:texts.join("\n").slice(0,60_000),isError:r.isError===true,...(r.structuredContent!==undefined?{structured:r.structuredContent}:{}),images};
  }

  async close(){try{await this.transport?.close();}finally{this.transport=null;}}
  kill(){const t=this.transport as {kill?:()=>void}|null;t?.kill?.();}
}
