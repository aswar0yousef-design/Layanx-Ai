import {spawn} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {applyStorageDefaults,migrateLegacyStore,readJsonFile,resolveDataPaths,writeFileAtomic,type DataPaths} from "../platform/paths.js";
import {serializeCapabilities} from "../platform/capabilities.js";
import {AccessManager} from "../security/access.js";
import {freeLoopbackPort,startGateway,type GatewayHandle} from "../security/local-gateway.js";
import {applySecretsToEnv,ensureGeneratedSecret,openSecretStore,type SecretStore} from "../security/secret-store.js";
import {AdaptiveOllama} from "../providers/adaptive-ollama.js";
import {buildModelPlan,currentMachine,detectGpuVramBytes,recommendNumCtx,type ModelTask} from "../providers/ollama-discovery.js";
import {consoleLogger,installLogTee,type Logger} from "./log.js";
import {CLOUD_PROVIDERS,loadSettings,saveSettings,type CloudProviderId,type LocalSettings} from "./settings.js";
import {createSetupRoutes} from "./setup-routes.js";

export interface LocalContext{
  paths:DataPaths;
  store:SecretStore;
  installId:string;
  apiToken:string;
  settings:LocalSettings;
  ollama:AdaptiveOllama;
  appliedModels:Record<string,string|undefined>;
}

const SESSION_COOKIE="layanx_session";

function loadInstallId(file:string):string{
  const existing=readJsonFile<{installId?:string}>(file,{}).installId;
  if(existing&&/^lx-[a-z0-9]{16}$/.test(existing))return existing;
  const installId="lx-"+crypto.randomBytes(10).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g,"").padEnd(16,"0").slice(0,16);
  writeFileAtomic(file,JSON.stringify({installId,createdAt:new Date().toISOString()},null,2));
  return installId;
}


/**
 * Cloud models (Claude / OpenAI / Gemini) are enabled for every provider that has
 * a key, unless switched off on the setup page. The runtime then runs in hybrid
 * mode: local first, cloud for failures and (policy "complex") hard goals.
 */
export function applyCloudSettings(env:NodeJS.ProcessEnv,settings:LocalSettings,log:Logger=consoleLogger):string[]{
  const enabled:string[]=[];
  for(const [id,info] of Object.entries(CLOUD_PROVIDERS) as Array<[CloudProviderId,(typeof CLOUD_PROVIDERS)[CloudProviderId]]>){
    const prefix=id==="anthropic"?"ANTHROPIC":id==="openai"?"OPENAI":"GEMINI";
    const on=settings.cloud.policy!=="off"&&Boolean(env[info.keyName]?.trim())&&settings.cloud.disabled[id]!==true;
    env[`${prefix}_ENABLED`]=on?"true":"false";
    const model=settings.cloud.models[id];
    if(model)env[`${prefix}_MODEL`]=model;
    else if(!env[`${prefix}_MODEL`]?.trim())env[`${prefix}_MODEL`]=info.defaultModel;
    if(on)enabled.push(id);
  }
  if(env.LAYANX_AI_MODE!=="cloud")env.LAYANX_AI_MODE=enabled.length?"hybrid":"local";
  env.LAYANX_CLOUD_POLICY=settings.cloud.policy;
  env.LAYANX_CLOUD_ORDER=settings.cloud.order.join(",");
  if(settings.cloud.monthlyBudgetUsd!=null)env.LAYANX_CLOUD_MONTHLY_BUDGET_USD=String(settings.cloud.monthlyBudgetUsd);else delete env.LAYANX_CLOUD_MONTHLY_BUDGET_USD;
  if(settings.cloud.monthlyTokens!=null)env.LAYANX_CLOUD_MONTHLY_TOKENS=String(settings.cloud.monthlyTokens);else delete env.LAYANX_CLOUD_MONTHLY_TOKENS;
  for(const [id,price] of Object.entries(settings.cloud.prices??{})){if(!price)continue;const key=id.toUpperCase();env[`LAYANX_PRICE_${key}_IN`]=String(price.input);env[`LAYANX_PRICE_${key}_OUT`]=String(price.output);}
  log("info",enabled.length?`cloud models available (${settings.cloud.policy}): ${enabled.join(", ")}`:"cloud models: none (local only)");
  return enabled;
}

/**
 * The existing LocalSecretVault encrypts with LAYANX_SECRET_VAULT_KEY. Keep it in the
 * DPAPI store so it never has to live in .env. Never invent a new key for a vault
 * that already exists: that would make its entries unreadable.
 */
async function ensureVaultKey(store:SecretStore,env:NodeJS.ProcessEnv,log:Logger):Promise<void>{
  if(store.get("LAYANX_SECRET_VAULT_KEY"))return;
  const fromEnv=env.LAYANX_SECRET_VAULT_KEY?.trim();
  if(fromEnv&&fromEnv.length>=16){await store.set("LAYANX_SECRET_VAULT_KEY",fromEnv);log("info","moved LAYANX_SECRET_VAULT_KEY into the secret store");return;}
  const vault=env.LAYANX_SECRET_VAULT_PATH;
  if(vault&&fs.existsSync(vault)){
    log("warn",`An existing vault (${vault}) needs its original key. Run: npm run secrets -- set LAYANX_SECRET_VAULT_KEY`);
    return;
  }
  await ensureGeneratedSecret(store,"LAYANX_SECRET_VAULT_KEY");
}

/**
 * Prepare process.env for the existing runtime. The runtime keeps reading the
 * same variables it always did; they are now filled from the encrypted local
 * store and from what is actually installed in Ollama.
 */
export async function bootstrapLocalRuntime(env:NodeJS.ProcessEnv=process.env,log:Logger=consoleLogger):Promise<LocalContext>{
  const paths=resolveDataPaths(env);
  if(migrateLegacyStore(path.resolve(".layanx"),paths))log("info",`copied legacy .layanx data into ${paths.storeDir}`);
  const store=await openSecretStore(paths.dataDir);
  const installId=loadInstallId(paths.installFile);
  const apiToken=await ensureGeneratedSecret(store,"LAYANX_API_TOKEN","lxm_");
  const storage=applyStorageDefaults(env,paths);
  if(storage.length)log("info",`storage defaults -> ${paths.storeDir}`);
  await ensureVaultKey(store,env,log);
  const applied=applySecretsToEnv(store,env);
  log("info",`secret store: ${store.backend} (${applied.length} values loaded, names only are ever shown)`);

  const settings=loadSettings(paths.settingsFile);
  env.LAYANX_CAPABILITIES=serializeCapabilities(settings.capabilities);
  applyCloudSettings(env,settings,log);
  // Where the agent works: each sub-folder of this root is a project (the "project" field in the UI).
  env.LAYANX_WORKSPACE_ROOT=settings.workspaceRoot||env.LAYANX_WORKSPACE_ROOT||path.join(os.homedir(),"LayanX-Projects");
  try{fs.mkdirSync(path.join(env.LAYANX_WORKSPACE_ROOT,"default"),{recursive:true});}catch(error){log("warn",`cannot create the projects folder ${env.LAYANX_WORKSPACE_ROOT}: ${(error as Error).message}`);}
  log("info",`projects folder: ${env.LAYANX_WORKSPACE_ROOT}`);
  env.LAYANX_PROJECTS_FILE=path.join(paths.dataDir,"projects.json");
  env.LAYANX_TRUST_FILE=path.join(paths.dataDir,"trust.json");
  env.LAYANX_ISOLATION_FILE=path.join(paths.dataDir,"isolation.json");
  if(settings.briefingTime&&!env.LAYANX_BRIEFING_TIME)env.LAYANX_BRIEFING_TIME=settings.briefingTime;

  // Local speech-to-text: use whisper-server automatically when it is running on its default port.
  if(!env.LAYANX_STT_BASE_URL?.trim()){
    const sttPort=Number(env.LAYANX_STT_PORT)||8178;
    try{
      const r=await fetch(`http://127.0.0.1:${sttPort}/`,{signal:AbortSignal.timeout(800)});
      if(r.status<500){
        env.LAYANX_STT_BASE_URL=`http://127.0.0.1:${sttPort}/v1`;
        log("info",`local speech-to-text found on port ${sttPort} (Whisper)`);
        // Whisper shares the GPU: plan the language models around ~1.2 GB less VRAM.
        const vram=detectGpuVramBytes(env);
        if(vram>0&&!env.LAYANX_GPU_VRAM_MB?.trim())env.LAYANX_GPU_VRAM_MB=String(Math.max(0,Math.round(vram/2**20)-1200));
      }
    }catch{log("info","no local speech-to-text server; the assistant uses the browser engine (run scripts\\windows\\install-whisper.ps1 to add Whisper)");}
  }
  // Models: honour explicit user choices only if they are really installed.
  const pinned:Partial<Record<ModelTask,string>>={...settings.pinnedModels};
  if(env.OLLAMA_MODEL&&!pinned.planning)pinned.planning=env.OLLAMA_MODEL;
  if(env.OLLAMA_VISION_MODEL&&!pinned.vision)pinned.vision=env.OLLAMA_VISION_MODEL;
  const ollama=new AdaptiveOllama({baseUrl:env.OLLAMA_BASE_URL,pinned});
  const discovery=await ollama.refresh();
  const plan=buildModelPlan(discovery,currentMachine(),pinned);
  for(const warning of plan.warnings)log("warn",warning);
  if(!discovery.reachable)log("warn",discovery.error??"Ollama is not reachable.");
  const appliedModels:Record<string,string|undefined>={};
  const main=plan.assignments.planning??plan.assignments.general;
  if(main){env.OLLAMA_MODEL=main;appliedModels.OLLAMA_MODEL=main;}
  if(plan.assignments.vision){env.OLLAMA_VISION_MODEL=plan.assignments.vision;appliedModels.OLLAMA_VISION_MODEL=plan.assignments.vision;}
  else if(discovery.reachable)env.OLLAMA_VISION_MODEL=""; // no vision model installed: do not register a model that cannot run
  const context:Record<string,number>={};
  for(const name of new Set(Object.values(plan.assignments).filter((n):n is string=>Boolean(n)))){
    const model=discovery.models.find(m=>m.name===name);
    if(model)context[name]=recommendNumCtx(model,currentMachine());
  }
  env.LAYANX_OLLAMA_CONTEXT=JSON.stringify(context);
  env.LAYANX_OLLAMA_THINKING_MODELS=discovery.models.filter(m=>m.capabilities.includes("thinking")).map(m=>m.name).join(",");
  env.LAYANX_OLLAMA_MODEL_PLAN=JSON.stringify(plan.assignments);
  writeFileAtomic(paths.modelsCacheFile,JSON.stringify({discovery,plan},null,2));
  log("info",`ollama: ${discovery.reachable?`${discovery.models.length} models`:"unreachable"}; plan ${JSON.stringify(plan.assignments)}`);
  return{paths,store,installId,apiToken,settings,ollama,appliedModels};
}

function tcpReachable(port:number):Promise<boolean>{
  return new Promise(resolve=>{
    const socket=net.connect(port,"127.0.0.1");
    socket.setTimeout(800);
    socket.once("connect",()=>{socket.destroy();resolve(true);});
    socket.once("error",()=>resolve(false));
    socket.once("timeout",()=>{socket.destroy();resolve(false);});
  });
}

export async function runLocalHost():Promise<void>{
  const originalEnv={...process.env};
  const env=process.env;
  const paths=resolveDataPaths(env);
  installLogTee(paths.logFile);
  const log=consoleLogger;
  log("info",`starting LayanX local host (pid ${process.pid}, node ${process.versions.node}, ${process.platform})`);

  const ctx=await bootstrapLocalRuntime(env,log);
  let settings=ctx.settings;
  const publicPort=Number(env.LAYANX_PUBLIC_PORT)||settings.publicPort;
  const flowPublicPort=Number(env.LAYANX_FLOW_PUBLIC_PORT)||settings.flowPublicPort;
  const mobileActive=settings.mobileAccess;
  const remoteActive=settings.remoteAccess;
  // LAN phones, or Tailscale by IP, need a non-loopback listener; `tailscale serve` and tunnels work on loopback too.
  const bindHost=mobileActive||remoteActive?"0.0.0.0":"127.0.0.1";

  // The existing API and Flow Builder move to random loopback ports behind the gateway.
  const apiInternal=await freeLoopbackPort();
  const flowInternal=await freeLoopbackPort();
  env.LAYANX_API_HOST="127.0.0.1";
  env.LAYANX_API_PORT=String(apiInternal);
  env.LAYANX_FLOW_HOST="127.0.0.1";
  env.LAYANX_FLOW_PORT=String(flowInternal);
  env.LAYANX_API_TOKEN=ctx.apiToken;
  env.LAYANX_API_REQUIRE_TOKEN="true";
  if(!env.LAYANX_OAUTH_REDIRECT_URI)env.LAYANX_OAUTH_REDIRECT_URI=`http://127.0.0.1:${publicPort}/v1/oauth/callback`;

  const access=new AccessManager({devicesFile:paths.devicesFile,launchTicketFile:paths.launchTicketFile,sessionsFile:paths.sessionsFile,masterToken:ctx.apiToken});
  let restartFlag=false;
  let runtime:{state:"starting"|"running"|"failed";error?:string}={state:"starting"};
  let gateway:GatewayHandle|null=null;

  const cleanup=()=>{try{fs.rmSync(paths.pidFile,{force:true});}catch{}};
  const shutdown=async(code=0)=>{
    log("info","shutting down");
    setTimeout(()=>{cleanup();process.exit(code);},3000).unref();
    try{await gateway?.close();}catch{}
    cleanup();
    process.exit(code);
  };
  const restart=()=>{
    log("info","restarting");
    const out=fs.openSync(paths.logFile,"a");
    const child=spawn(process.execPath,[...process.execArgv,...process.argv.slice(1)],{
      cwd:process.cwd(),detached:true,windowsHide:true,stdio:["ignore",out,out],env:{...originalEnv,LAYANX_RESTARTED:"1"}
    });
    child.unref();
    void shutdown(0);
  };

  const routes=createSetupRoutes({
    installId:ctx.installId,
    dataDir:paths.dataDir,
    store:ctx.store,
    access,
    ollama:ctx.ollama,
    getSettings:()=>settings,
    updateSettings:next=>{settings=next;saveSettings(paths.settingsFile,next);},
    mobileActive,
    remoteActive,
    appliedModels:ctx.appliedModels,
    runtimeState:()=>runtime,
    markRestartRequired:()=>{restartFlag=true;},
    restartRequired:()=>restartFlag,
    restart,
    shutdown:()=>{void shutdown(0);},
    sessionCookie:SESSION_COOKIE
  });

  gateway=await startGateway({
    bindHost,
    listeners:[
      {name:"api",publicPort,internalPort:apiInternal},
      {name:"flow",publicPort:flowPublicPort,internalPort:flowInternal}
    ],
    access,
    internalToken:ctx.apiToken,
    authHeader:env.LAYANX_GATEWAY_AUTH_HEADER||"authorization",
    mobileAccess:mobileActive,
    remoteAccess:remoteActive,
    remoteHosts:settings.remoteHosts,
    sessionCookie:SESSION_COOKIE,
    handleOwnRoute:routes,
    log
  });
  if(mobileActive)log("warn","phone access is ON: the gateway listens on the LAN. Only paired devices are accepted.");

  writeFileAtomic(paths.pidFile,String(process.pid));
  process.on("exit",cleanup);
  process.on("SIGINT",()=>void shutdown(0));
  process.on("SIGTERM",()=>void shutdown(0));

  const entry=env.LAYANX_API_ENTRY?.trim();
  const target=entry?pathToFileURL(path.resolve(entry)).href:new URL("../api.js",import.meta.url).href;
  try{
    await import(target);
    for(let i=0;i<60&&runtime.state==="starting";i++){
      if(await tcpReachable(apiInternal)){runtime={state:"running"};break;}
      await new Promise(r=>setTimeout(r,500));
    }
    if(runtime.state==="starting")runtime={state:"failed",error:"The runtime did not open its API port. It may ignore LAYANX_API_PORT; see the log."};
  }catch(error){
    runtime={state:"failed",error:(error as Error).message};
    log("error",`runtime failed to start: ${(error as Error).stack??error}`);
  }
  log(runtime.state==="running"?"info":"error",`runtime ${runtime.state}${runtime.error?": "+runtime.error:""}`);
  access.issueLaunchTicket();
  log("info",`ready: http://127.0.0.1:${publicPort}/setup`);
}
