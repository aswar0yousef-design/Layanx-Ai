import type {LayanXCore} from "../core/orchestrator.js";
import type {McpManager,McpServerConfig,McpServerStatus} from "../mcp/manager.js";
import {PLATFORMS,platform,type PlatformEntry,type PlatformId} from "./catalog.js";

/**
 * Connecting a platform = one owner action that uses what LayanX already has:
 *   1. the token goes into the local secret store (and into this process at once, no restart);
 *   2. GitHub and Vercel tokens are checked with the platform before anything is saved;
 *   3. a platform with an official MCP server is added to the MCP manager from the catalog and
 *      approved there (the owner is the one clicking), replacing any copy of the same server
 *      added earlier under another id, so the same tools never exist twice.
 * Disconnecting removes the platform's MCP server and its own token; a shared token
 * (GITHUB_TOKEN, ANTHROPIC_API_KEY) stays, because other parts of LayanX use it.
 */
export interface SecretWriter{names():string[];set(name:string,value:string):Promise<void>;delete(name:string):Promise<boolean>}
export interface PlatformDeps{/** The owner's secret store (setup routes); the agent's view reads only the environment. */store?:SecretWriter;mcp:McpManager|null;env?:NodeJS.ProcessEnv;fetcher?:typeof fetch;toolNames?:()=>string[];onSharedSecretChanged?:(name:string)=>void}
export type PlatformState="connected"|"available"|"needs_token"|"error"|"starting";
export interface PlatformStatus{
  id:PlatformId;label:string;category:string;about:PlatformEntry["about"];via:PlatformEntry["via"];docs:string;
  state:PlatformState;
  secrets:Array<{name:string;set:boolean;optional:boolean;shared:boolean;createUrl:string;scopes:PlatformEntry["secrets"][number]["scopes"]}>;
  mcp?:{id:string;approved:boolean;connected:boolean;tools:string[];error?:string};
  /** LayanX tool names this platform gives the agent right now. */
  tools:string[];
  /** Managed elsewhere (the setup page): no connect button here. */
  managedOnSetup?:boolean;
}

const sameServer=(a:Pick<McpServerConfig,"source"|"url"|"args">,b:Pick<McpServerConfig,"source"|"url"|"args">)=>{
  const pkg=(c:Pick<McpServerConfig,"source"|"args">)=>c.source?.package??(c.args??[]).map(x=>x.replace(/@\d[\w.+-]*$/,"").replace(/==.*$/,"")).find(x=>/^@?[\w.-]+(\/[\w.-]+)?$/.test(x)&&!x.startsWith("-"));
  const where=(u:string)=>{try{const x=new URL(u);return x.host.toLowerCase()+x.pathname.replace(/\/+$/,"");}catch{return u;}};
  if(a.url&&b.url)return where(a.url)===where(b.url);
  const pa=pkg(a),pb=pkg(b);return!!pa&&pa===pb;
};
/** MCP servers (by id) that are a copy of a catalog platform's server. */
export function platformServerCopies(servers:Array<Pick<McpServerConfig,"id"|"source"|"url"|"args">>,p:PlatformEntry):string[]{
  return p.mcp?servers.filter(s=>s.id!==p.mcp!.id&&sameServer(s,p.mcp!)).map(s=>s.id):[];
}
/** The catalog platform an MCP config duplicates, if any (used to stop an agent from requesting a second copy). */
export function platformFor(config:Pick<McpServerConfig,"source"|"url"|"args">):PlatformEntry|undefined{
  return PLATFORMS.find(p=>p.mcp&&sameServer(config,p.mcp));
}

export function platformStatuses(deps:PlatformDeps):PlatformStatus[]{
  const env=deps.env??process.env;
  const stored=new Set(deps.store?.names()??[]);
  const has=(n:string)=>stored.has(n)||!!env[n];
  const servers:McpServerStatus[]=deps.mcp?.list()??[];
  const tools=deps.toolNames?.()??[];
  return PLATFORMS.map(p=>{
    const secrets=p.secrets.map(s=>({name:s.name,set:has(s.name),optional:!!s.optional,shared:!!s.shared,createUrl:s.createUrl,scopes:s.scopes}));
    const server=p.mcp?servers.find(s=>s.id===p.mcp!.id):undefined;
    const own=tools.filter(t=>p.tools.some(x=>x.endsWith(".")?t.startsWith(x):t===x));
    const mcpTools=server?.tools??[];
    const required=secrets.filter(s=>!s.optional);
    const tokenOk=required.every(s=>s.set);
    let state:PlatformState;
    if(!p.mcp)state=(p.activeWhen?.anySecret?p.activeWhen.anySecret.some(has):tokenOk)?"connected":"needs_token";
    else if(server)state=server.connected?"connected":server.error?"error":server.approved&&server.enabled?"starting":"available";
    else state=tokenOk?"available":"needs_token";
    return{id:p.id,label:p.label,category:p.category,about:p.about,via:p.via,docs:p.docs,state,secrets,
      ...(p.mcp?{mcp:{id:p.mcp.id,approved:!!server?.approved,connected:!!server?.connected,tools:mcpTools,...(server?.error?{error:server.error}:{})}}:{}),
      tools:[...own,...mcpTools],...(p.id==="claude"?{managedOnSetup:true}:{})};
  });
}

async function verifyToken(id:PlatformId,value:string,fetcher:typeof fetch):Promise<void>{
  const check:{url:string;headers:Record<string,string>}|null=id==="github"?{url:"https://api.github.com/user",headers:{accept:"application/vnd.github+json","x-github-api-version":"2022-11-28"}}:
    id==="vercel"?{url:"https://api.vercel.com/v2/user",headers:{}}:null;
  if(!check)return;
  const r=await fetcher(check.url,{headers:{authorization:"Bearer "+value,"user-agent":"LayanX",...check.headers},redirect:"error",signal:AbortSignal.timeout(15_000)});
  if(r.status===401||r.status===403)throw new Error(`${platform(id).label} rejected this token (HTTP ${r.status}). Create a new one and paste it again.`);
  if(!r.ok)throw new Error(`${platform(id).label} could not check the token (HTTP ${r.status}). Try again in a minute.`);
}

export async function connectPlatform(id:string,values:Record<string,unknown>,deps:PlatformDeps&{store:SecretWriter}):Promise<{status:PlatformStatus;replaced:string[]}>{
  const p=platform(id);
  if(p.id==="claude")throw new Error("Claude is managed on the setup page (cloud models and Claude Code).");
  const env=deps.env??process.env;
  const given:Array<[string,string]>=[];
  for(const s of p.secrets){
    const raw=values[s.name];
    const value=typeof raw==="string"?raw.trim():"";
    if(value){
      if(value.length>4096||/\s/.test(value))throw new Error(s.name+" looks wrong: paste only the token.");
      given.push([s.name,value]);
    }else if(!s.optional&&!(deps.store.names().includes(s.name)||env[s.name]))throw new Error("Paste the "+s.name+" token first.");
  }
  const primary=given.find(([n])=>n===p.secrets[0]?.name);
  if(primary)await verifyToken(p.id,primary[1],deps.fetcher??fetch);
  for(const [name,value] of given){
    const before=env[name];
    await deps.store.set(name,value);env[name]=value;
    if(p.secrets.find(s=>s.name===name)?.shared&&before!==value)deps.onSharedSecretChanged?.(name);
  }
  const replaced:string[]=[];
  if(p.mcp){
    const mcp=deps.mcp;if(!mcp)throw new Error("LayanX is still starting; try again in a few seconds.");
    for(const copy of platformServerCopies(mcp.list(),p)){await mcp.remove(copy);replaced.push(copy);}
    const existing=mcp.list().find(s=>s.id===p.mcp!.id);
    if(existing&&JSON.stringify({...existing.source,url:existing.url,args:existing.args})!==JSON.stringify({...p.mcp.source,url:p.mcp.url,args:p.mcp.args}))await mcp.remove(existing.id);
    if(!mcp.list().some(s=>s.id===p.mcp!.id))mcp.add({...p.mcp,note:"Platform: "+p.label});
    try{await mcp.approve(p.mcp.id);}
    catch(error){
      const status=platformStatuses(deps).find(x=>x.id===p.id)!;
      return{status:{...status,state:"error",mcp:{...status.mcp!,error:error instanceof Error?error.message:String(error)}},replaced};
    }
  }
  return{status:platformStatuses(deps).find(x=>x.id===p.id)!,replaced};
}

export async function disconnectPlatform(id:string,deps:PlatformDeps&{store:SecretWriter}):Promise<PlatformStatus>{
  const p=platform(id);
  if(p.id==="claude")throw new Error("Claude is managed on the setup page.");
  const env=deps.env??process.env;
  if(p.mcp&&deps.mcp?.list().some(s=>s.id===p.mcp!.id))await deps.mcp.remove(p.mcp.id);
  for(const s of p.secrets){if(s.shared)continue;await deps.store.delete(s.name);delete env[s.name];}
  return platformStatuses(deps).find(x=>x.id===p.id)!;
}

/** platforms.list: what the agent can work on now, and what to ask the owner to connect. */
export function registerPlatformTools(core:LayanXCore,deps:()=>PlatformDeps|null){
  core.tools.register({name:"platforms.list",description:"list the website platforms LayanX can work on (GitHub, Vercel, Hostinger, Cloudflare, Netlify, Supabase, Context7, Claude): which are connected, the tools each gives you, and which the owner still has to connect in Control Center -> Integrations -> Platforms",
    permission:"L1_READ",dangerous:false,actions:["platforms.list"],tags:["platforms","integrations","hosting","deploy","website","منصات","ربط"]});
  core.toolAdapters.register("platforms.list",{async execute(){
    const d=deps();if(!d)return{platforms:[],note:"LayanX is still starting."};
    return{platforms:platformStatuses(d).map(s=>({id:s.id,label:s.label,state:s.state,about:s.about.en,tools:s.tools.slice(0,40),
      ...(s.state!=="connected"?{ownerAction:s.managedOnSetup?"Ask the owner to add ANTHROPIC_API_KEY on the setup page.":`Ask the owner to connect ${s.label} in Control Center -> Integrations -> Platforms (${s.secrets.filter(x=>!x.optional).map(x=>x.name).join(", ")||"no token needed"}).`}:{})}))};
  }});
}
