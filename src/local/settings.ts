import {readJsonFile,writeFileAtomic} from "../platform/paths.js";
import {ALL_CAPABILITIES,type CapabilityGroup} from "../platform/capabilities.js";
import {MODEL_TASKS,type ModelTask} from "../providers/ollama-discovery.js";

export interface LocalSettings{
  mobileAccess:boolean;
  publicPort:number;
  flowPublicPort:number;
  capabilities:Partial<Record<CapabilityGroup,boolean>>;
  pinnedModels:Partial<Record<ModelTask,string>>;
  /** Open the voice assistant window (listening) when LayanX starts. */
  openAssistantOnStart:boolean;
  /** HH:MM daily briefing time, "" = off. */
  briefingTime:string;
  /** Cloud models for work local models cannot do well. */
  cloud:CloudSettings;
  /** Control from anywhere (Tailscale or a tunnel). Phones still need a pairing token. */
  remoteAccess:boolean;
  /** Extra public hostnames that reach this PC through a tunnel (e.g. layanx.example.com). */
  remoteHosts:string[];
  /** Folder that holds your projects; each sub-folder is one LayanX project. "" = ~/LayanX-Projects. */
  workspaceRoot:string;
}

export type CloudProviderId="openai"|"anthropic"|"gemini";
export const CLOUD_PROVIDERS:Record<CloudProviderId,{label:string;keyName:string;defaultModel:string}>={
  anthropic:{label:"Claude (Anthropic)",keyName:"ANTHROPIC_API_KEY",defaultModel:"claude-sonnet-5-5"},
  openai:{label:"OpenAI (GPT)",keyName:"OPENAI_API_KEY",defaultModel:"gpt-5.6-terra"},
  gemini:{label:"Google Gemini",keyName:"GEMINI_API_KEY",defaultModel:"gemini-3.6-flash"}
};
export interface CloudSettings{
  policy:"off"|"fallback"|"complex";
  order:CloudProviderId[];
  models:Partial<Record<CloudProviderId,string>>;
  disabled:Partial<Record<CloudProviderId,boolean>>;
  /** Monthly cap for paid cloud use; null = no cap. Dollars need prices (per 1M tokens). */
  monthlyBudgetUsd?:number|null;
  monthlyTokens?:number|null;
  prices?:Partial<Record<CloudProviderId,{input:number;output:number}>>;
}

export const DEFAULT_SETTINGS:LocalSettings={mobileAccess:false,publicPort:3000,flowPublicPort:3100,capabilities:{},pinnedModels:{},openAssistantOnStart:false,briefingTime:"",
  cloud:{policy:"fallback",order:["anthropic","openai","gemini"],models:{},disabled:{}},remoteAccess:false,remoteHosts:[],workspaceRoot:""};

function port(value:unknown,fallback:number):number{
  return typeof value==="number"&&Number.isInteger(value)&&value>0&&value<65536?value:fallback;
}

export function sanitizeSettings(raw:unknown,base:LocalSettings=DEFAULT_SETTINGS):LocalSettings{
  const input=(raw&&typeof raw==="object"?raw:{}) as Record<string,unknown>;
  const capabilities:Partial<Record<CapabilityGroup,boolean>>={...base.capabilities};
  if(input.capabilities&&typeof input.capabilities==="object")
    for(const [k,v] of Object.entries(input.capabilities as Record<string,unknown>))
      if((ALL_CAPABILITIES as string[]).includes(k)&&typeof v==="boolean")capabilities[k as CapabilityGroup]=v;
  const pinnedModels:Partial<Record<ModelTask,string>>={...base.pinnedModels};
  if(input.pinnedModels&&typeof input.pinnedModels==="object")
    for(const [k,v] of Object.entries(input.pinnedModels as Record<string,unknown>)){
      if(!(MODEL_TASKS as readonly string[]).includes(k))continue;
      if(v===null||v==="")delete pinnedModels[k as ModelTask];
      else if(typeof v==="string"&&/^[\w.:/-]{1,128}$/.test(v))pinnedModels[k as ModelTask]=v;
    }
  return{
    mobileAccess:typeof input.mobileAccess==="boolean"?input.mobileAccess:base.mobileAccess,
    publicPort:port(input.publicPort,base.publicPort),
    flowPublicPort:port(input.flowPublicPort,base.flowPublicPort),
    capabilities,
    pinnedModels,
    openAssistantOnStart:typeof input.openAssistantOnStart==="boolean"?input.openAssistantOnStart:base.openAssistantOnStart,
    cloud:sanitizeCloud(input.cloud,base.cloud),
    workspaceRoot:typeof input.workspaceRoot==="string"&&input.workspaceRoot.length<=400&&!/[\0<>|"?*]/.test(input.workspaceRoot)?input.workspaceRoot.trim():base.workspaceRoot,
    remoteAccess:typeof input.remoteAccess==="boolean"?input.remoteAccess:base.remoteAccess,
    remoteHosts:Array.isArray(input.remoteHosts)?input.remoteHosts.filter((h):h is string=>typeof h==="string").map(h=>h.trim().toLowerCase()).filter(h=>/^[a-z0-9.-]{3,253}$/.test(h)&&h.includes(".")).slice(0,5):base.remoteHosts,
    briefingTime:typeof input.briefingTime==="string"&&(input.briefingTime===""||/^([01]?\d|2[0-3]):[0-5]\d$/.test(input.briefingTime))?input.briefingTime:base.briefingTime
  };
}

export function loadSettings(file:string):LocalSettings{
  return sanitizeSettings(readJsonFile<unknown>(file,{}));
}

export function saveSettings(file:string,settings:LocalSettings):void{
  writeFileAtomic(file,JSON.stringify(settings,null,2));
}

const PROVIDER_IDS=Object.keys(CLOUD_PROVIDERS) as CloudProviderId[];
function sanitizeCloud(raw:unknown,base:CloudSettings):CloudSettings{
  const input=(raw&&typeof raw==="object"?raw:{}) as Record<string,unknown>;
  const policy=input.policy==="off"||input.policy==="fallback"||input.policy==="complex"?input.policy:base.policy;
  const order=Array.isArray(input.order)?[...new Set(input.order.filter((v):v is CloudProviderId=>PROVIDER_IDS.includes(v as CloudProviderId)))]:base.order;
  const models={...base.models};
  if(input.models&&typeof input.models==="object")for(const [k,v] of Object.entries(input.models as Record<string,unknown>)){
    if(!PROVIDER_IDS.includes(k as CloudProviderId))continue;
    if(v===null||v==="")delete models[k as CloudProviderId];else if(typeof v==="string"&&/^[\w.:/@-]{2,100}$/.test(v))models[k as CloudProviderId]=v;
  }
  const disabled={...base.disabled};
  if(input.disabled&&typeof input.disabled==="object")for(const [k,v] of Object.entries(input.disabled as Record<string,unknown>))
    if(PROVIDER_IDS.includes(k as CloudProviderId)&&typeof v==="boolean")disabled[k as CloudProviderId]=v;
  const limit=(v:unknown,fallback:number|null|undefined,max:number)=>v===null||v===""?null:typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=max?v:fallback??null;
  const prices={...(base.prices??{})};
  if(input.prices&&typeof input.prices==="object")for(const [k,v] of Object.entries(input.prices as Record<string,unknown>)){
    if(!PROVIDER_IDS.includes(k as CloudProviderId))continue;
    const p=v as {input?:unknown;output?:unknown}|null;
    if(p===null){delete prices[k as CloudProviderId];continue;}
    const i=Number(p?.input),o=Number(p?.output);
    if(Number.isFinite(i)&&Number.isFinite(o)&&i>=0&&o>=0&&i<1000&&o<1000)prices[k as CloudProviderId]={input:i,output:o};
  }
  return{policy,order:order.length?order:base.order,models,disabled,monthlyBudgetUsd:limit(input.monthlyBudgetUsd,base.monthlyBudgetUsd,100000),monthlyTokens:limit(input.monthlyTokens,base.monthlyTokens,1e12),prices};
}
