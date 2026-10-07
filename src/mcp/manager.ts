import fs from "node:fs";
import path from "node:path";
import type {LayanXCore} from "../core/orchestrator.js";
import {McpClient,type McpEndpoint,type McpTool} from "./client.js";
import {safeChildEnv} from "../platform/safe-env.js";
import {writeFileAtomic} from "../platform/paths.js";

/**
 * MCP servers the owner approved. Each server's tools become LayanX tools named
 * `mcp.<server>.<tool>`: dangerous by default (owner approval per call) unless the owner marked a
 * tool as safe (read-only). Anything an agent finds in the registry is only *requested*: it stays
 * disabled until the owner approves it on this computer. Versions must be pinned (no "latest"),
 * because a hijacked release (Trivy and LiteLLM, March 2026) must never be installed silently.
 */
export interface McpServerConfig{
  id:string;
  name:string;
  transport:"stdio"|"http";
  command?:string;
  args?:string[];
  url?:string;
  /** Names of secrets (from the LayanX secret store) passed to this server only; nothing else leaks. */
  envFromSecrets?:string[];
  /** Plain, non-secret environment values. */
  env?:Record<string,string>;
  enabled:boolean;
  approved:boolean;
  safeTools?:string[];
  source?:{registry?:string;version?:string;package?:string};
  requestedBy?:string;
  note?:string;
  addedAt:string;
  approvedAt?:string;
}
export interface McpServerStatus extends McpServerConfig{connected:boolean;tools:string[];error?:string;era?:string|null;protocolVersion?:string|null}

const ID=/^[a-z0-9][a-z0-9-]{1,39}$/;
const SECRET_NAME=/^[A-Z][A-Z0-9_]{1,63}$/;
const RUNNERS=new Set(["npx","node","uvx","python","python3","docker","deno","bun"]);

export function sanitizeToolName(name:string):string{return name.toLowerCase().replace(/[^a-z0-9_]+/g,"_").replace(/^_+|_+$/g,"").slice(0,60)||"tool";}
function clean(text:unknown,max:number):string{return String(text??"").replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g," ").trim().slice(0,max);}

/** A package spec must name an exact version: pkg@1.2.3, pkg==1.2.3, image:1.2.3 or image@sha256:... */
export function pinnedSpec(config:Pick<McpServerConfig,"transport"|"command"|"args">):string|null{
  if(config.transport!=="stdio")return "remote";
  const args=config.args??[];
  const cmd=config.command??"";
  if(cmd==="npx"){const spec=args.find(a=>!a.startsWith("-"));return spec&&/^(@[\w.-]+\/)?[\w.-]+@\d+\.\d+\.\d+([-+][\w.]+)?$/.test(spec)?spec:null;}
  if(cmd==="uvx"){const spec=args.find(a=>!a.startsWith("-"));return spec&&/^[\w.-]+(\[[\w,.-]+\])?==\d+(\.\d+)*([\w.+-]*)$/.test(spec)?spec:null;}
  if(cmd==="docker"){const image=args.find(a=>/[:@]/.test(a)&&!a.startsWith("-"));return image&&(/@sha256:[a-f0-9]{64}$/.test(image)||(/:[\w.-]+$/.test(image)&&!/:latest$/.test(image)))?image:null;}
  return "local"; // node/python running a local file the owner chose
}

export function validateConfig(input:unknown):McpServerConfig{
  if(!input||typeof input!=="object")throw new Error("Server config is required.");
  const c=input as Record<string,unknown>;
  const id=String(c.id??"").trim().toLowerCase();
  if(!ID.test(id))throw new Error("id must be 2-40 lowercase letters, digits or dashes.");
  const transport=c.transport==="http"?"http":"stdio";
  const config:McpServerConfig={id,name:clean(c.name??id,80),transport,enabled:false,approved:false,addedAt:new Date().toISOString()};
  if(transport==="stdio"){
    const command=String(c.command??"").trim();
    if(!RUNNERS.has(command)&&!(path.isAbsolute(command)&&/\.(exe|js|mjs|cjs)$/i.test(command)))throw new Error("command must be one of "+[...RUNNERS].join(", ")+" or a full path to an .exe/.js file (never .cmd/.bat/.ps1).");
    const args=Array.isArray(c.args)?c.args.map(a=>String(a)):[];
    if(args.length>40||args.some(a=>a.length>500||/[\r\n\0]/.test(a)))throw new Error("args are too long or contain line breaks.");
    config.command=command;config.args=args;
  }else{
    const url=String(c.url??"");
    let u:URL;try{u=new URL(url);}catch{throw new Error("url is invalid.");}
    if(u.protocol!=="https:"&&!(u.protocol==="http:"&&["127.0.0.1","localhost","[::1]"].includes(u.hostname)))throw new Error("Remote MCP servers must use https.");
    if(u.username||u.password)throw new Error("Put credentials in secrets, not in the URL.");
    config.url=u.toString();
  }
  if(Array.isArray(c.envFromSecrets)){const names=c.envFromSecrets.map(String);if(names.some(n=>!SECRET_NAME.test(n)))throw new Error("envFromSecrets must be secret names like GITHUB_TOKEN.");config.envFromSecrets=names.slice(0,10);}
  if(c.env&&typeof c.env==="object"){const env:Record<string,string>={};for(const [k,v] of Object.entries(c.env as Record<string,unknown>).slice(0,20)){if(!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(k))throw new Error("Invalid env name "+k);if(/(KEY|TOKEN|SECRET|PASSWORD)/i.test(k))throw new Error("Put "+k+" in secrets and list it in envFromSecrets.");env[k]=String(v).slice(0,500);}config.env=env;}
  if(Array.isArray(c.safeTools))config.safeTools=c.safeTools.map(String).slice(0,200);
  if(c.source&&typeof c.source==="object"){const s=c.source as Record<string,unknown>;config.source={...(s.registry?{registry:clean(s.registry,200)}:{}),...(s.version?{version:clean(s.version,40)}:{}),...(s.package?{package:clean(s.package,200)}:{})};}
  if(c.note)config.note=clean(c.note,300);
  if(c.requestedBy)config.requestedBy=clean(c.requestedBy,40);
  return config;
}

/** The command to spawn, Windows-safe: npx runs through npx-cli.js with this Node (no .cmd shims). */
export function resolveCommand(config:McpServerConfig):{command:string;args:string[]}{
  const args=config.args??[];
  if(config.command==="node")return{command:process.execPath,args};
  if(config.command==="npx"){
    const dir=path.dirname(process.execPath);
    for(const c of [path.join(dir,"node_modules","npm","bin","npx-cli.js"),path.join(dir,"..","lib","node_modules","npm","bin","npx-cli.js")])
      if(fs.existsSync(c))return{command:process.execPath,args:[c,"-y",...args.filter(a=>a!=="-y")]};
    if(process.platform==="win32")throw new Error("npx-cli.js was not found next to node.exe; reinstall Node.js.");
    return{command:"npx",args:["-y",...args.filter(a=>a!=="-y")]};
  }
  if(config.command&&/\.(js|mjs|cjs)$/i.test(config.command))return{command:process.execPath,args:[config.command,...args]};
  return{command:config.command!,args};
}

type ToolHandle={name:string;tool:McpTool};
interface Live{client:McpClient;tools:ToolHandle[];error?:string}

export class McpManager{
  private servers:McpServerConfig[]=[];
  private readonly live=new Map<string,Live>();
  private readonly errors=new Map<string,string>();
  constructor(private readonly core:LayanXCore,private readonly file:string,private readonly options:{agents?:string[];timeoutMs?:number}={}){this.load();}

  static defaultFile(env:NodeJS.ProcessEnv=process.env):string{
    return path.join(env.LAYANX_STORE_DIR??env.LAYANX_DATA_DIR??path.join(process.cwd(),".layanx"),"mcp-servers.json");
  }
  private load(){try{const data=JSON.parse(fs.readFileSync(this.file,"utf8")) as {servers?:McpServerConfig[]};this.servers=Array.isArray(data.servers)?data.servers:[];}catch{this.servers=[];}}
  private save(){fs.mkdirSync(path.dirname(this.file),{recursive:true});writeFileAtomic(this.file,JSON.stringify({servers:this.servers},null,2));}
  private get(id:string){const s=this.servers.find(x=>x.id===id);if(!s)throw new Error("Unknown MCP server: "+id);return s;}

  list():McpServerStatus[]{
    return this.servers.map(s=>{const l=this.live.get(s.id);return{...structuredClone(s),connected:Boolean(l),tools:l?.tools.map(t=>t.name)??[],...(this.errors.get(s.id)?{error:this.errors.get(s.id)}:{}),era:l?.client.era??null,protocolVersion:l?.client.protocolVersion??null};});
  }

  /** Owner (or an agent's request) adds a server: it stays disabled until approve(). */
  add(input:unknown):McpServerConfig{
    const config=validateConfig(input);
    if(this.servers.some(s=>s.id===config.id))throw new Error("A server with id "+config.id+" already exists.");
    if(this.servers.length>=50)throw new Error("Too many MCP servers.");
    this.servers.push(config);this.save();return structuredClone(config);
  }

  async approve(id:string):Promise<McpServerStatus>{
    const s=this.get(id);
    if(!pinnedSpec(s))throw new Error("Pin an exact version first (for example pkg@1.2.3, pkg==1.2.3 or image:1.2.3) - 'latest' is never installed.");
    s.approved=true;s.enabled=true;s.approvedAt=new Date().toISOString();this.save();
    await this.connect(id);
    return this.list().find(x=>x.id===id)!;
  }
  async disable(id:string){const s=this.get(id);s.enabled=false;this.save();await this.disconnect(id);}
  async remove(id:string){await this.disconnect(id);this.servers=this.servers.filter(s=>s.id!==id);this.errors.delete(id);this.save();}
  async setSafeTools(id:string,tools:string[]){const s=this.get(id);s.safeTools=[...new Set(tools.map(String))].slice(0,200);this.save();if(this.live.has(id)){await this.disconnect(id);await this.connect(id);}}

  /** Connect every approved, enabled server (startup). Failures are recorded, never fatal. */
  async start():Promise<void>{
    await Promise.all(this.servers.filter(s=>s.enabled&&s.approved).map(s=>this.connect(s.id).catch(()=>undefined)));
  }

  private endpoint(s:McpServerConfig):McpEndpoint{
    if(s.transport==="http"){
      const headers:Record<string,string>={};
      // A single secret can be sent as a bearer token to a remote server the owner approved.
      const tokenName=s.envFromSecrets?.[0];if(tokenName&&process.env[tokenName])headers.authorization="Bearer "+process.env[tokenName];
      return{transport:"http",http:{url:s.url!,headers}};
    }
    const {command,args}=resolveCommand(s);
    const env=safeChildEnv();
    for(const [k,v] of Object.entries(s.env??{}))env[k]=v;
    for(const name of s.envFromSecrets??[])if(process.env[name])env[name]=process.env[name];
    return{transport:"stdio",stdio:{command,args,env}};
  }

  async connect(id:string):Promise<void>{
    const s=this.get(id);
    if(!s.approved||!s.enabled)throw new Error("Server "+id+" is not approved.");
    await this.disconnect(id);
    const client=new McpClient(this.endpoint(s),this.options.timeoutMs??30_000);
    try{
      await client.connect();
      const tools=await client.listTools();
      const handles:ToolHandle[]=[];
      for(const tool of tools.slice(0,200)){
        const name=`mcp.${s.id}.${sanitizeToolName(tool.name)}`;
        if(this.core.tools.has(name)||handles.some(h=>h.name===name))continue;
        const safe=(s.safeTools??[]).includes(tool.name);
        const description=`[MCP ${clean(s.name,40)}] ${clean(tool.description,400)}${tool.inputSchema?" Input: "+clean(JSON.stringify(tool.inputSchema),600):""}`;
        this.core.tools.register({name,description,permission:safe?"L2_ANALYZE":"L4_EXECUTE",dangerous:!safe,actions:[clean(tool.name,80),"call "+clean(tool.name,80)],tags:["mcp",s.id,...sanitizeToolName(tool.name).split("_").filter(w=>w.length>2).slice(0,5)]});
        this.core.toolAdapters.register(name,{execute:async request=>{
          const args=request.payload&&typeof request.payload==="object"&&!Array.isArray(request.payload)?request.payload as Record<string,unknown>:{};
          const live=this.live.get(s.id);if(!live)throw new Error("MCP server "+s.id+" is not connected.");
          const result=await live.client.callTool(tool.name,args);
          if(result.isError)throw new Error("MCP tool "+tool.name+" failed: "+result.text.slice(0,1000));
          return{server:s.id,tool:tool.name,text:result.text,...(result.structured!==undefined?{structured:result.structured}:{}),...(result.images.length?{images:result.images.slice(0,2)}:{})};
        }});
        handles.push({name,tool});
      }
      for(const agent of this.options.agents??["core"])this.core.agents.allowTools(agent,handles.map(h=>h.name));
      this.live.set(id,{client,tools:handles});this.errors.delete(id);
    }catch(error){
      await client.close().catch(()=>undefined);
      this.errors.set(id,error instanceof Error?error.message:String(error));
      throw error;
    }
  }

  async disconnect(id:string):Promise<void>{
    const l=this.live.get(id);if(!l)return;
    this.live.delete(id);
    for(const h of l.tools){this.core.tools.unregister(h.name);this.core.toolAdapters.unregister(h.name);}
    for(const agent of this.options.agents??["core"])this.core.agents.revokeTools(agent,l.tools.map(h=>h.name));
    await l.client.close().catch(()=>undefined);
  }
  async stop(){await Promise.all([...this.live.keys()].map(id=>this.disconnect(id)));}
  /** Called on process exit (synchronous): stop every server process. */
  killAll(){for(const l of this.live.values())l.client.kill();}
}

// ---------------------------------------------------------------------------- registry search
export interface RegistryEntry{name:string;description:string;version:string;suggested:Partial<McpServerConfig>|null;secrets:string[];remote?:string}
const REGISTRY=process.env.LAYANX_MCP_REGISTRY_URL??"https://registry.modelcontextprotocol.io";

/** Search the official MCP Registry and propose a pinned, Windows-safe config for each result. */
export async function searchRegistry(query:string,options:{fetcher?:typeof fetch;limit?:number}={}):Promise<RegistryEntry[]>{
  const q=query.trim().slice(0,100);if(!q)throw new Error("query is required.");
  const url=`${REGISTRY}/v0.1/servers?search=${encodeURIComponent(q)}&version=latest&limit=${Math.min(Math.max(options.limit??15,1),50)}`;
  const response=await (options.fetcher??fetch)(url,{redirect:"error",signal:AbortSignal.timeout(15_000),headers:{accept:"application/json"}});
  if(!response.ok)throw new Error("MCP registry returned HTTP "+response.status+".");
  const data=await response.json() as {servers?:Array<{server?:Record<string,unknown>}>};
  return (data.servers??[]).map(item=>item.server??{}).filter(s=>typeof s.name==="string").map(s=>{
    const name=String(s.name);const version=clean(s.version,40);
    const packages=Array.isArray(s.packages)?s.packages as Array<Record<string,unknown>>:[];
    const remotes=Array.isArray(s.remotes)?s.remotes as Array<Record<string,unknown>>:[];
    const id=sanitizeToolName(name.split("/").pop()??name).replace(/_/g,"-").slice(0,40).replace(/^-+|-+$/g,"")||"server";
    const envOf=(p:Record<string,unknown>)=>(Array.isArray(p.environmentVariables)?p.environmentVariables as Array<Record<string,unknown>>:[]);
    let suggested:Partial<McpServerConfig>|null=null;let secrets:string[]=[];
    const stdio=packages.find(p=>((p.transport as Record<string,unknown>)?.type??"stdio")==="stdio"&&["npm","pypi","oci"].includes(String(p.registryType)));
    if(stdio){
      const pkg=String(stdio.identifier??"");const v=String(stdio.version??version);
      const extra=(Array.isArray(stdio.packageArguments)?stdio.packageArguments as Array<Record<string,unknown>>:[]).map(a=>a.value??a.default).filter((x):x is string=>typeof x==="string"&&x.length<200);
      const base={id,name:clean(name,80),transport:"stdio" as const,source:{registry:name,version:v,package:pkg}};
      if(stdio.registryType==="npm")suggested={...base,command:"npx",args:[`${pkg}@${v}`,...extra]};
      else if(stdio.registryType==="pypi")suggested={...base,command:"uvx",args:[`${pkg}==${v}`,...extra]};
      else suggested={...base,command:"docker",args:["run","-i","--rm",pkg.includes(":")||pkg.includes("@")?pkg:`${pkg}:${v}`]};
      secrets=envOf(stdio).filter(e=>e.isSecret===true||/(KEY|TOKEN|SECRET|PASSWORD)/i.test(String(e.name))).map(e=>String(e.name)).filter(n=>SECRET_NAME.test(n));
      const plain=envOf(stdio).filter(e=>!secrets.includes(String(e.name))&&e.isRequired===true&&typeof e.default==="string");
      if(plain.length)suggested.env=Object.fromEntries(plain.map(e=>[String(e.name),String(e.default)]));
      if(secrets.length)suggested.envFromSecrets=secrets;
    }
    const remote=remotes.find(r=>r.type==="streamable-http"&&typeof r.url==="string"&&!String(r.url).includes("{"));
    if(!suggested&&remote)suggested={id,name:clean(name,80),transport:"http",url:String(remote.url),source:{registry:name,version}};
    return{name,description:clean(s.description,300),version,suggested,secrets,...(remote?{remote:String(remote.url)}:{})};
  });
}

let shared:McpManager|null=null;
export function setMcpManager(manager:McpManager|null){shared=manager;}
export function getMcpManager():McpManager|null{return shared;}
