import fs from "node:fs";
import {getMcpManager,searchRegistry} from "../mcp/manager.js";
import {acpEditorConfig} from "../acp/config.js";
import crypto from "node:crypto";
import os from "node:os";
import type {AccessManager} from "../security/access.js";
import type {RouteContext} from "../security/local-gateway.js";
import {lanUrls} from "../security/local-gateway.js";
import {assertSecretName,type SecretStore} from "../security/secret-store.js";
import {CAPABILITY_GROUPS,ALL_CAPABILITIES} from "../platform/capabilities.js";
import {recommendedPull} from "../providers/ollama-discovery.js";
import type {AdaptiveOllama} from "../providers/adaptive-ollama.js";
import {CLOUD_PROVIDERS,sanitizeSettings,type CloudProviderId,type LocalSettings} from "./settings.js";
import {tailscaleInfo,tailscaleServe,type TailscaleInfo} from "../platform/tailscale.js";
import {linkProject,listLinkedProjects,unlinkProject} from "../platform/linked-projects.js";
import {listTrust,setTrust,trustLevel,TRUST_LEVELS,type TrustLevel} from "../autonomy/trust.js";
import {dockerVersion,ISOLATION_LEVELS,listIsolation,restrictedAvailable,setIsolation,type Isolation} from "../autonomy/sandbox.js";

let tsCache:{at:number;info:TailscaleInfo}|null=null;
async function tailscale():Promise<TailscaleInfo>{
  if(tsCache&&Date.now()-tsCache.at<60_000)return tsCache.info;
  const info=await tailscaleInfo().catch(()=>({installed:false,running:false,ips:[]}));
  tsCache={at:Date.now(),info};
  return info;
}

function workspaceInfo(settings:LocalSettings){
  const root=process.env.LAYANX_WORKSPACE_ROOT??"";
  let projects:string[]=[];
  try{projects=fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.name.startsWith(".")).map(e=>e.name).slice(0,200);}catch{}
  const linked=listLinkedProjects();
  return{root,configured:settings.workspaceRoot,projects:[...new Set([...projects,...linked.map(l=>l.projectId)])],linked,trust:listTrust(process.env.LAYANX_TRUST_FILE),isolation:listIsolation(process.env.LAYANX_ISOLATION_FILE),docker:dockerVersion(),restricted:restrictedAvailable()};
}

/** Every address a paired phone can use for this PC, best first. */
async function phoneAddresses(host:SetupHost,settings:LocalSettings):Promise<string[]>{
  const out:string[]=[];
  if(host.remoteActive){
    const ts=await tailscale();
    if(ts.dnsName)out.push(`https://${ts.dnsName}`);
    for(const h of settings.remoteHosts)out.push(`https://${h}`);
    if(host.mobileActive||host.remoteActive)for(const ip of ts.ips)if(ip.includes("."))out.push(`http://${ip}:${settings.publicPort}`);
  }
  if(host.mobileActive)out.push(...lanUrls(settings.publicPort));
  return [...new Set(out)];
}

/** Lists the models a cloud key can use; doubles as a connection test. Keys never leave this request. */
async function listCloudModels(id:CloudProviderId,key:string):Promise<string[]>{
  const signal=AbortSignal.timeout(15000);
  if(id==="openai"){
    const r=await fetch(process.env.OPENAI_HEALTH_URL||"https://api.openai.com/v1/models",{headers:{authorization:`Bearer ${key}`},signal});
    if(!r.ok)throw new Error(`OpenAI: HTTP ${r.status} ${(await r.text()).slice(0,200)}`);
    const d=await r.json() as {data?:Array<{id?:string}>};
    return (d.data??[]).map(m=>m.id??"").filter(n=>/^(gpt|o\d|chatgpt)/i.test(n)).sort().reverse();
  }
  if(id==="anthropic"){
    const r=await fetch(process.env.ANTHROPIC_HEALTH_URL||"https://api.anthropic.com/v1/models?limit=100",{headers:{"x-api-key":key,"anthropic-version":"2023-06-01"},signal});
    if(!r.ok)throw new Error(`Anthropic: HTTP ${r.status} ${(await r.text()).slice(0,200)}`);
    const d=await r.json() as {data?:Array<{id?:string}>};
    return (d.data??[]).map(m=>m.id??"").filter(Boolean);
  }
  const r=await fetch((process.env.GEMINI_HEALTH_URL||"https://generativelanguage.googleapis.com/v1beta/models")+"?pageSize=200",{headers:{"x-goog-api-key":key},signal});
  if(!r.ok)throw new Error(`Gemini: HTTP ${r.status} ${(await r.text()).slice(0,200)}`);
  const d=await r.json() as {models?:Array<{name?:string;supportedGenerationMethods?:string[]}>};
  return (d.models??[]).filter(m=>(m.supportedGenerationMethods??[]).includes("generateContent")).map(m=>(m.name??"").replace(/^models\//,"")).filter(n=>/^gemini/i.test(n)).sort().reverse();
}
import {renderSetupPage} from "./setup-page.js";

/** Managed by LayanX itself; shown but never editable from the UI. */
export const SYSTEM_SECRETS=new Set(["LAYANX_API_TOKEN","LAYANX_SECRET_VAULT_KEY"]);

export const KNOWN_SECRETS=[
  "OPENAI_API_KEY","ANTHROPIC_API_KEY","GEMINI_API_KEY","GROQ_API_KEY","OPENROUTER_API_KEY","MISTRAL_API_KEY","COHERE_API_KEY","HF_TOKEN",
  "GITHUB_TOKEN","LAYANX_SHOPIFY_ACCESS_TOKEN","LAYANX_WOOCOMMERCE_CONSUMER_KEY","LAYANX_WOOCOMMERCE_CONSUMER_SECRET","LAYANX_COMMERCE_TOKEN",
  "LAYANX_META_ADS_TOKEN","LAYANX_TIKTOK_ADS_TOKEN","LAYANX_GOOGLE_ADS_TOKEN","LAYANX_X_ADS_TOKEN",
  "LAYANX_TIKTOK_OAUTH_CLIENT_SECRET","LAYANX_GOOGLE_OAUTH_CLIENT_SECRET","LAYANX_LINKEDIN_OAUTH_CLIENT_SECRET","LAYANX_PINTEREST_OAUTH_CLIENT_SECRET","LAYANX_YOUTUBE_OAUTH_CLIENT_SECRET",
  "GOOGLE_CLIENT_SECRET","GOOGLE_REFRESH_TOKEN","YAHOO_APP_PASSWORD","QF_CLIENT_SECRET"
];

export interface SetupHost{
  installId:string;
  dataDir:string;
  store:SecretStore;
  access:AccessManager;
  ollama:AdaptiveOllama;
  getSettings():LocalSettings;
  updateSettings(next:LocalSettings):void;
  /** The phone listener is bound right now (settings may say otherwise until restart). */
  mobileActive:boolean;
  /** Remote (anywhere) access is active right now. */
  remoteActive?:boolean;
  appliedModels:Record<string,string|undefined>;
  runtimeState():{state:"starting"|"running"|"failed";error?:string};
  markRestartRequired():void;
  restartRequired():boolean;
  restart():void;
  shutdown():void;
  sessionCookie:string;
}

function owner(ctx:RouteContext):boolean{
  if(ctx.principal?.kind==="owner"&&ctx.loopback)return true;
  ctx.sendJson(ctx.principal?403:401,{error:ctx.principal?"owner_only":"unauthorized",message:ctx.principal?"Only the owner on this computer can do this.":"Open LayanX from the desktop shortcut."});
  return false;
}

function loopbackOnly(ctx:RouteContext):boolean{
  if(ctx.loopback)return true;
  ctx.sendJson(404,{error:"not_found"});
  return false;
}

export function createSetupRoutes(host:SetupHost):(ctx:RouteContext)=>Promise<boolean>{
  return async ctx=>{
    const {method,url}=ctx;
    const path=url.pathname.replace(/\/+$/,"")||"/";

    if(path==="/v1/gateway/health"&&method==="GET"){ctx.sendJson(200,{ok:true,app:"layanx-gateway"});return true;}
    if(path==="/favicon.ico"&&method==="GET"){ctx.res.writeHead(204,{"cache-control":"max-age=86400"});ctx.res.end();return true;}

    if(path==="/setup"&&method==="GET"){
      if(!loopbackOnly(ctx))return true;
      const nonce=crypto.randomBytes(16).toString("base64");
      ctx.res.writeHead(200,{
        "content-type":"text/html; charset=utf-8",
        "cache-control":"no-store",
        "content-security-policy":`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        "x-frame-options":"DENY",
        "x-content-type-options":"nosniff",
        "referrer-policy":"no-referrer"
      });
      ctx.res.end(renderSetupPage(nonce));
      return true;
    }

    if(path==="/v1/setup/launch-ticket"&&method==="POST"){
      if(!loopbackOnly(ctx))return true;
      const ticket=host.access.issueLaunchTicket();
      ctx.sendJson(200,{ok:true,expiresAt:ticket.expiresAt});
      return true;
    }

    if(path==="/v1/session/launch"&&method==="POST"){
      if(!loopbackOnly(ctx))return true;
      const body=await ctx.readJson() as {code?:unknown};
      const session=host.access.exchangeLaunchTicket(body.code);
      if(!session){ctx.sendJson(401,{error:"invalid_launch_code",message:"This launch link expired. Open LayanX again from the desktop shortcut."});return true;}
      ctx.sendJson(200,{ok:true},{"set-cookie":`${host.sessionCookie}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`});
      return true;
    }

    if(path==="/v1/pair/complete"&&method==="POST"){
      const body=await ctx.readJson() as {code?:unknown;deviceName?:unknown};
      const result=host.access.completePairing(body.code,body.deviceName,ctx.remoteAddress);
      if(!result.ok){ctx.sendJson(result.status,{error:"pairing_failed",message:result.error});return true;}
      ctx.sendJson(200,{ok:true,deviceId:result.deviceId,deviceToken:result.deviceToken,installId:host.installId,authorization:"Bearer"});
      return true;
    }

    if(path==="/v1/device/whoami"&&method==="GET"){
      if(ctx.principal?.kind!=="device"){ctx.sendJson(401,{error:"unauthorized"});return true;}
      ctx.sendJson(200,{deviceId:ctx.principal.device.id,name:ctx.principal.device.name,installId:host.installId,addresses:await phoneAddresses(host,host.getSettings())});
      return true;
    }

    // Link a folder (e.g. the one open in VS Code) as a project. Only from this computer:
    // a remote phone must never be able to point the agent at arbitrary folders.
    if(path==="/v1/projects/link"&&(method==="POST"||method==="GET"||method==="DELETE")){
      if(!ctx.loopback||!ctx.principal){ctx.sendJson(403,{error:"local_only",message:"Projects can only be linked from this computer."});return true;}
      const file=process.env.LAYANX_PROJECTS_FILE;
      if(!file){ctx.sendJson(503,{error:"not_configured"});return true;}
      if(method==="GET"){ctx.sendJson(200,{projects:listLinkedProjects()});return true;}
      const body=await ctx.readJson() as {projectId?:unknown;path?:unknown};
      if(typeof body.projectId!=="string"){ctx.sendJson(400,{error:"projectId_required"});return true;}
      if(method==="DELETE"){ctx.sendJson(200,{removed:unlinkProject(file,body.projectId)});return true;}
      if(typeof body.path!=="string"){ctx.sendJson(400,{error:"path_required"});return true;}
      try{ctx.sendJson(200,{ok:true,...linkProject(file,body.projectId,body.path)});}
      catch(error){ctx.sendJson(400,{ok:false,error:"invalid_folder",message:(error as Error).message});}
      return true;
    }

    // Isolation decides where project commands run. Owner only, on this computer.
    if(path==="/v1/projects/isolation"&&(method==="GET"||method==="PUT")){
      if(!ctx.loopback||ctx.principal?.kind!=="owner"){ctx.sendJson(403,{error:"owner_only",message:"Isolation can only be changed by the owner on this computer."});return true;}
      const file=process.env.LAYANX_ISOLATION_FILE;
      if(method==="GET"){ctx.sendJson(200,{levels:ISOLATION_LEVELS,projects:listIsolation(file),docker:dockerVersion(true),restricted:restrictedAvailable()});return true;}
      const body=await ctx.readJson() as {projectId?:unknown;level?:unknown};
      if(!file||typeof body.projectId!=="string"||!ISOLATION_LEVELS.includes(body.level as Isolation)){ctx.sendJson(400,{error:"invalid"});return true;}
      if(body.level==="restricted"&&!restrictedAvailable()){ctx.sendJson(409,{error:"restricted_unavailable",message:"Restricted isolation runs on Windows only."});return true;}
      if(body.level==="docker"&&!dockerVersion(true)){ctx.sendJson(409,{error:"docker_unavailable",message:"Docker is not running on this computer. Install/start Docker Desktop first."});return true;}
      setIsolation(file,body.projectId,body.level as Isolation);ctx.sendJson(200,{ok:true});return true;
    }

    // Trust levels decide what runs without approval: only the owner, on this computer, may change them.
    if(path==="/v1/projects/trust"&&(method==="GET"||method==="PUT")){
      if(!ctx.loopback||ctx.principal?.kind!=="owner"){
        if(method==="GET"&&ctx.principal){const id=ctx.url.searchParams.get("projectId")??"default";ctx.sendJson(200,{projectId:id,level:trustLevel(id)});return true;}
        ctx.sendJson(403,{error:"owner_only",message:"Trust levels can only be changed by the owner on this computer."});return true;
      }
      const file=process.env.LAYANX_TRUST_FILE;
      if(method==="GET"){ctx.sendJson(200,{levels:TRUST_LEVELS,projects:listTrust(file),default:process.env.LAYANX_DEFAULT_TRUST??"supervised"});return true;}
      const body=await ctx.readJson() as {projectId?:unknown;level?:unknown};
      if(!file||typeof body.projectId!=="string"||!TRUST_LEVELS.includes(body.level as TrustLevel)){ctx.sendJson(400,{error:"invalid"});return true;}
      setTrust(file,body.projectId,body.level as TrustLevel);
      ctx.sendJson(200,{ok:true,projectId:body.projectId,level:body.level});return true;
    }

    // MCP tool servers: anyone signed in may look; only the owner on this computer may add, approve or remove.
    if(path==="/v1/mcp/servers"||path.startsWith("/v1/mcp/servers/")||path==="/v1/mcp/registry"){
      if(!ctx.principal){ctx.sendJson(401,{error:"unauthorized"});return true;}
      const mcp=getMcpManager();
      if(!mcp){ctx.sendJson(503,{error:"runtime_starting",message:"LayanX is still starting."});return true;}
      try{
        if(path==="/v1/mcp/servers"&&method==="GET"){ctx.sendJson(200,{servers:mcp.list()});return true;}
        if(path==="/v1/mcp/registry"&&method==="GET"){ctx.sendJson(200,{results:await searchRegistry(ctx.url.searchParams.get("q")??"")});return true;}
        if(!owner(ctx))return true;
        if(path==="/v1/mcp/servers"&&method==="POST"){ctx.sendJson(200,{ok:true,server:mcp.add(await ctx.readJson())});return true;}
        const m=/^\/v1\/mcp\/servers\/([a-z0-9-]{2,40})\/(approve|disable|remove|safe-tools)$/.exec(path);
        if(m&&method==="POST"){
          const [,id,op]=m as unknown as [string,string,string];
          if(op==="approve"){ctx.sendJson(200,{ok:true,server:await mcp.approve(id)});return true;}
          if(op==="disable"){await mcp.disable(id);ctx.sendJson(200,{ok:true});return true;}
          if(op==="remove"){await mcp.remove(id);ctx.sendJson(200,{ok:true});return true;}
          const body=await ctx.readJson() as {tools?:unknown};
          await mcp.setSafeTools(id,Array.isArray(body.tools)?body.tools.map(String):[]);ctx.sendJson(200,{ok:true});return true;
        }
        ctx.sendJson(404,{error:"not_found"});return true;
      }catch(error){ctx.sendJson(400,{error:"mcp_failed",message:error instanceof Error?error.message:String(error)});return true;}
    }

    if(!path.startsWith("/v1/setup/")&&!path.startsWith("/v1/pair/")&&path!=="/v1/session/logout")return false;
    if(!owner(ctx))return true;

    if(path==="/v1/session/logout"&&method==="POST"){
      const cookie=/(?:^|;\s*)layanx_session=([^;]+)/.exec(String(ctx.req.headers.cookie??""));
      if(cookie?.[1])host.access.endSession(decodeURIComponent(cookie[1]));
      ctx.sendJson(200,{ok:true},{"set-cookie":`${host.sessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`});
      return true;
    }

    if(path==="/v1/setup/status"&&method==="GET"){
      const settings=host.getSettings();
      const {discovery,plan,machine}=host.ollama.status();
      ctx.sendJson(200,{
        installId:host.installId,
        dataDir:host.dataDir,
        platform:process.platform,
        acp:acpEditorConfig(),
        runtime:host.runtimeState(),
        restartRequired:host.restartRequired(),
        gateway:{publicPort:settings.publicPort,flowPublicPort:settings.flowPublicPort,mobileAccess:settings.mobileAccess,mobileActive:host.mobileActive,lanUrls:host.mobileActive?lanUrls(settings.publicPort):[]},
        ollama:{
          baseUrl:host.ollama.baseUrl,
          reachable:discovery?.reachable??false,
          version:discovery?.version??null,
          error:discovery?.error??null,
          ramGB:Math.round(machine.totalMemBytes/2**30),
          recommendedPull:recommendedPull(machine),
          models:(discovery?.models??[]).map(m=>({name:m.name,paramsB:m.paramsB?Math.round(m.paramsB*10)/10:0,sizeGB:m.sizeBytes?Math.round(m.sizeBytes/1e8)/10:0,capabilities:m.capabilities,source:m.capabilitySource,contextLength:m.contextLength})),
          plan:plan??{assignments:{},warnings:[]}
        },
        appliedModels:host.appliedModels,
        pinnedModels:settings.pinnedModels,
        assistant:{openOnStart:settings.openAssistantOnStart,briefingTime:settings.briefingTime,stt:process.env.LAYANX_STT_BASE_URL?"local":"browser"},
        cloud:{
          policy:settings.cloud.policy,
          order:settings.cloud.order,
          monthlyBudgetUsd:settings.cloud.monthlyBudgetUsd??null,
          monthlyTokens:settings.cloud.monthlyTokens??null,
          prices:settings.cloud.prices??{},
          providers:(Object.keys(CLOUD_PROVIDERS) as CloudProviderId[]).map(id=>({
            id,label:CLOUD_PROVIDERS[id].label,keyName:CLOUD_PROVIDERS[id].keyName,
            hasKey:Boolean(host.store.get(CLOUD_PROVIDERS[id].keyName)||process.env[CLOUD_PROVIDERS[id].keyName]),
            enabled:settings.cloud.disabled[id]!==true,
            active:process.env[(id==="anthropic"?"ANTHROPIC":id==="openai"?"OPENAI":"GEMINI")+"_ENABLED"]==="true",
            model:settings.cloud.models[id]??CLOUD_PROVIDERS[id].defaultModel
          }))
        },
        workspace:workspaceInfo(settings),
        owner:{name:(()=>{try{return os.userInfo().username;}catch{return "";}})(),computer:os.hostname()},
        remote:{enabled:settings.remoteAccess,active:Boolean(host.remoteActive),hosts:settings.remoteHosts,tailscale:await tailscale(),addresses:await phoneAddresses(host,settings)},
        secrets:{
          backend:host.store.backend,
          names:host.store.names().map(name=>({name,system:SYSTEM_SECRETS.has(name)})),
          known:KNOWN_SECRETS.filter(n=>!host.store.names().includes(n))
        },
        capabilities:Object.fromEntries(ALL_CAPABILITIES.map(g=>[g,{label:CAPABILITY_GROUPS[g],enabled:settings.capabilities[g]!==false}])),
        devices:host.access.listDevices(),
        links:[
          {label:"المساعد الصوتي",href:`http://127.0.0.1:${settings.publicPort}/voice`},
          {label:"لوحة التحكم",href:`http://127.0.0.1:${settings.publicPort}/`},
          {label:"منشئ التدفقات",href:`http://127.0.0.1:${settings.flowPublicPort}/flow`}
        ]
      });
      return true;
    }

    if(path==="/v1/setup/ollama/refresh"&&method==="POST"){
      await host.ollama.refresh();
      host.markRestartRequired();
      ctx.sendJson(200,{ok:true});
      return true;
    }

    if(path==="/v1/setup/secrets"&&(method==="PUT"||method==="POST")){
      const body=await ctx.readJson() as {name?:unknown;value?:unknown};
      const name=assertSecretName(body.name);
      if(SYSTEM_SECRETS.has(name)){ctx.sendJson(400,{error:"system_secret",message:`${name} is managed by LayanX.`});return true;}
      if(typeof body.value!=="string"||!body.value){ctx.sendJson(400,{error:"invalid_value",message:"Enter a value."});return true;}
      await host.store.set(name,body.value);
      host.markRestartRequired();
      ctx.sendJson(200,{ok:true,name});
      return true;
    }

    const secretMatch=/^\/v1\/setup\/secrets\/([A-Z][A-Z0-9_]{1,63})$/.exec(path);
    if(secretMatch?.[1]&&method==="DELETE"){
      const name=secretMatch[1];
      if(SYSTEM_SECRETS.has(name)){ctx.sendJson(400,{error:"system_secret",message:`${name} is managed by LayanX.`});return true;}
      const removed=await host.store.delete(name);
      if(removed)host.markRestartRequired();
      ctx.sendJson(removed?200:404,{ok:removed});
      return true;
    }

    if(path==="/v1/setup/settings"&&(method==="PUT"||method==="POST")){
      const body=await ctx.readJson();
      const before=host.getSettings();
      const next=sanitizeSettings(body,before);
      host.updateSettings(next);
      if(JSON.stringify(before)!==JSON.stringify(next))host.markRestartRequired();
      ctx.sendJson(200,{ok:true,settings:next});
      return true;
    }

    if(path==="/v1/pair/start"&&method==="POST"){
      const pairing=host.access.startPairing();
      const settings=host.getSettings();
      ctx.sendJson(200,{...pairing,urls:await phoneAddresses(host,settings),computer:os.hostname()});
      return true;
    }

    if(path==="/v1/pair/devices"&&method==="GET"){ctx.sendJson(200,{devices:host.access.listDevices()});return true;}

    const deviceMatch=/^\/v1\/pair\/devices\/(dev_[a-f0-9]{12})$/.exec(path);
    if(deviceMatch?.[1]&&method==="DELETE"){
      const removed=host.access.revokeDevice(deviceMatch[1]);
      ctx.sendJson(removed?200:404,{ok:removed});
      return true;
    }

    if(path==="/v1/setup/cloud/test"&&method==="POST"){
      const body=await ctx.readJson() as {provider?:unknown};
      const id=body.provider as CloudProviderId;
      if(!(id in CLOUD_PROVIDERS)){ctx.sendJson(400,{error:"unknown_provider"});return true;}
      const key=host.store.get(CLOUD_PROVIDERS[id].keyName)||process.env[CLOUD_PROVIDERS[id].keyName];
      if(!key){ctx.sendJson(400,{ok:false,error:"no_key",message:`Save ${CLOUD_PROVIDERS[id].keyName} first.`});return true;}
      try{const models=await listCloudModels(id,key);ctx.sendJson(200,{ok:true,models:models.slice(0,60)});}
      catch(error){ctx.sendJson(200,{ok:false,message:(error as Error).message});}
      return true;
    }

    if(path==="/v1/setup/remote/tailscale-serve"&&method==="POST"){
      const result=await tailscaleServe(host.getSettings().publicPort);
      tsCache=null;
      ctx.sendJson(200,result);
      return true;
    }

    if(path==="/v1/setup/restart"&&method==="POST"){ctx.sendJson(200,{ok:true});setTimeout(()=>host.restart(),150);return true;}
    if(path==="/v1/setup/shutdown"&&method==="POST"){ctx.sendJson(200,{ok:true});setTimeout(()=>host.shutdown(),150);return true;}

    ctx.sendJson(404,{error:"not_found"});
    return true;
  };
}
