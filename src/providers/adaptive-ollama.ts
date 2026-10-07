import {
  buildModelPlan,currentMachine,discoverOllama,findModel,normalizeBaseUrl,ollamaRequestJson,rankModels,recommendNumCtx,recommendedPull,
  OllamaHttpError,type FetchLike,type MachineProfile,type ModelPlan,type ModelTask,type OllamaDiscovery,type OllamaModelProfile
} from "./ollama-discovery.js";

export interface ChatMessage{role:"system"|"user"|"assistant"|"tool";content:string;images?:string[]}
export interface ToolSpec{name:string;description:string;parameters?:Record<string,unknown>}
export interface ToolCall{name:string;arguments:Record<string,unknown>}

export interface ChatRequest{
  task?:ModelTask;
  /** Force a model. It must be installed. */
  model?:string;
  messages:ChatMessage[];
  /** true = any JSON, object = JSON schema (Ollama structured outputs). */
  json?:boolean|Record<string,unknown>;
  tools?:ToolSpec[];
  temperature?:number;
  timeoutMs?:number;
}

export interface ChatResult{
  model:string;
  content:string;
  toolCalls:ToolCall[];
  usedNativeTools:boolean;
  attempts:string[];
}

export class NoSuitableModelError extends Error{
  readonly task:ModelTask;
  constructor(task:ModelTask,message:string){super(message);this.name="NoSuitableModelError";this.task=task;}
}

export interface AdaptiveOllamaOptions{
  baseUrl?:string;
  fetchImpl?:FetchLike;
  machine?:MachineProfile;
  pinned?:Partial<Record<ModelTask,string>>;
  refreshMs?:number;
  timeoutMs?:number;
  maxModelAttempts?:number;
  keepAlive?:string;
}

const THINK_BLOCK=/<think>[\s\S]*?<\/think>/gi;
export const stripThinking=(text:string)=>text.replace(THINK_BLOCK,"").trim();

/** Extract the first complete JSON object/array from model text (handles ```json fences and chatter). */
export function extractJson(text:string):unknown{
  const cleaned=stripThinking(text).replace(/^\s*```(?:json)?\s*/i,"").replace(/\s*```\s*$/,"").trim();
  try{return JSON.parse(cleaned);}catch{}
  const start=cleaned.search(/[{[]/);
  if(start<0)throw new Error("No JSON found in model output.");
  const open=cleaned[start],close=open==="{"?"}":"]";
  let depth=0,inString=false,escape=false;
  for(let i=start;i<cleaned.length;i++){
    const ch=cleaned[i];
    if(inString){
      if(escape)escape=false;
      else if(ch==="\\")escape=true;
      else if(ch==='"')inString=false;
      continue;
    }
    if(ch==='"')inString=true;
    else if(ch===open)depth++;
    else if(ch===close&&--depth===0)return JSON.parse(cleaned.slice(start,i+1));
  }
  throw new Error("Model output contains incomplete JSON.");
}

function toolProtocolMessage(tools:ToolSpec[]):ChatMessage{
  const catalog=tools.map(t=>({name:t.name,description:t.description,parameters:t.parameters??{type:"object",properties:{}}}));
  return{role:"system",content:[
    "You can use tools. Available tools as JSON:",
    JSON.stringify(catalog),
    'Reply with ONLY one JSON object. To call a tool: {"tool":"<name>","arguments":{...}}. When no tool is needed: {"final":"<answer>"}.'
  ].join("\n")};
}

function parseToolProtocol(content:string,tools:ToolSpec[]):ToolCall[]{
  let value:unknown;
  try{value=extractJson(content);}catch{return[];}
  const names=new Set(tools.map(t=>t.name));
  const items=Array.isArray((value as {tool_calls?:unknown})?.tool_calls)?(value as {tool_calls:unknown[]}).tool_calls:[value];
  const calls:ToolCall[]=[];
  for(const item of items){
    if(!item||typeof item!=="object")continue;
    const obj=item as Record<string,unknown>;
    const name=typeof obj.tool==="string"?obj.tool:typeof obj.name==="string"?obj.name:undefined;
    const args=obj.arguments??obj.args??{};
    if(name&&names.has(name)&&args&&typeof args==="object"&&!Array.isArray(args))calls.push({name,arguments:args as Record<string,unknown>});
  }
  return calls;
}

function parseNativeToolCalls(raw:unknown):ToolCall[]{
  if(!Array.isArray(raw))return[];
  const calls:ToolCall[]=[];
  for(const item of raw){
    const fn=(item as {function?:{name?:unknown;arguments?:unknown}})?.function;
    if(!fn||typeof fn.name!=="string")continue;
    let args=fn.arguments;
    if(typeof args==="string"){try{args=JSON.parse(args);}catch{args={};}}
    calls.push({name:fn.name,arguments:args&&typeof args==="object"&&!Array.isArray(args)?args as Record<string,unknown>:{}});
  }
  return calls;
}

function isRetryable(error:unknown):boolean{
  if(error instanceof OllamaHttpError){
    if(error.status===404)return true;
    if(error.status>=500)return true;
    return /memory|not found|unable to load|out of/i.test(error.message);
  }
  const name=(error as Error)?.name;
  return name==="TimeoutError"||name==="AbortError"||/fetch failed|ECONNRESET|ECONNREFUSED/i.test(String((error as Error)?.message));
}

export function noModelMessage(task:ModelTask,discovery:OllamaDiscovery|null,machine:MachineProfile):string{
  if(!discovery?.reachable)return `Ollama is not running at ${discovery?.baseUrl??"http://127.0.0.1:11434"}. Start Ollama, then retry.`;
  if(task==="vision")return "No installed Ollama model can read images. Install one, e.g.: ollama pull llava:7b";
  if(task==="embedding")return "No installed embedding model. Install one, e.g.: ollama pull nomic-embed-text";
  return `No installed Ollama chat model. Install one, e.g.: ollama pull ${recommendedPull(machine)}`;
}

export class AdaptiveOllama{
  readonly baseUrl:string;
  private readonly fetchImpl:FetchLike;
  private readonly machine:MachineProfile;
  private readonly pinned:Partial<Record<ModelTask,string>>;
  private readonly refreshMs:number;
  private readonly timeoutMs:number;
  private readonly maxModelAttempts:number;
  private readonly keepAlive:string;
  private discovery:OllamaDiscovery|null=null;
  private plan:ModelPlan|null=null;
  private refreshing:Promise<OllamaDiscovery>|null=null;
  private readonly noNativeTools=new Set<string>();
  private readonly cooldown=new Map<string,number>();

  constructor(options:AdaptiveOllamaOptions={}){
    this.baseUrl=normalizeBaseUrl(options.baseUrl??process.env.OLLAMA_BASE_URL);
    this.fetchImpl=options.fetchImpl??(fetch as unknown as FetchLike);
    this.machine=options.machine??currentMachine();
    this.pinned=options.pinned??{};
    this.refreshMs=options.refreshMs??5*60_000;
    this.timeoutMs=options.timeoutMs??180_000;
    this.maxModelAttempts=options.maxModelAttempts??3;
    this.keepAlive=options.keepAlive??"10m";
  }

  async refresh():Promise<OllamaDiscovery>{
    if(this.refreshing)return this.refreshing;
    this.refreshing=discoverOllama(this.baseUrl,{fetchImpl:this.fetchImpl}).then(discovery=>{
      this.discovery=discovery;
      this.plan=buildModelPlan(discovery,this.machine,this.pinned);
      this.cooldown.clear();
      return discovery;
    }).finally(()=>{this.refreshing=null;});
    return this.refreshing;
  }

  private async ensureFresh(){
    const age=this.discovery?Date.now()-Date.parse(this.discovery.discoveredAt):Infinity;
    if(!this.discovery||!this.discovery.reachable||age>this.refreshMs)await this.refresh();
  }

  status(){return{baseUrl:this.baseUrl,discovery:this.discovery,plan:this.plan,machine:this.machine};}

  /** Ranked candidates for a task: the planned model first, then the next best installed ones. */
  candidates(task:ModelTask,forced?:string):OllamaModelProfile[]{
    const models=this.discovery?.models??[];
    if(forced){const m=findModel(models,forced);return m?[m]:[];}
    const now=Date.now();
    const ranked=rankModels(models,task,this.machine,this.discovery?.loaded??[]).filter(m=>(this.cooldown.get(m.name)??0)<now);
    const planned=this.plan?.assignments[task];
    const first=ranked.find(m=>m.name===planned);
    return first?[first,...ranked.filter(m=>m!==first)]:ranked;
  }

  async chat(request:ChatRequest):Promise<ChatResult>{
    await this.ensureFresh();
    const needsVision=request.messages.some(m=>(m.images?.length??0)>0);
    const task:ModelTask=needsVision?"vision":request.task??"general";
    const candidates=this.candidates(task,request.model).slice(0,this.maxModelAttempts);
    if(!candidates.length)throw new NoSuitableModelError(task,noModelMessage(task,this.discovery,this.machine));
    const attempts:string[]=[];
    let lastError:unknown;
    for(const model of candidates){
      attempts.push(model.name);
      try{
        const result=await this.chatOnce(model,request);
        return{...result,attempts};
      }catch(error){
        lastError=error;
        if(!isRetryable(error))throw error;
        this.cooldown.set(model.name,Date.now()+60_000);
      }
    }
    throw lastError;
  }

  private async chatOnce(model:OllamaModelProfile,request:ChatRequest):Promise<Omit<ChatResult,"attempts">>{
    const wantTools=(request.tools?.length??0)>0;
    const native=wantTools&&model.capabilities.includes("tools")&&!this.noNativeTools.has(model.name);
    const messages:ChatMessage[]=wantTools&&!native?[toolProtocolMessage(request.tools!),...request.messages]:request.messages;
    const options:Record<string,unknown>={num_ctx:recommendNumCtx(model,this.machine)};
    if(request.temperature!==undefined)options.temperature=request.temperature;
    const body:Record<string,unknown>={model:model.name,messages,stream:false,keep_alive:this.keepAlive,options};
    if(native)body.tools=request.tools!.map(t=>({type:"function",function:{name:t.name,description:t.description,parameters:t.parameters??{type:"object",properties:{}}}}));
    if(request.json)body.format=request.json===true?"json":request.json;
    else if(wantTools&&!native)body.format="json";
    let data:{message?:{content?:unknown;tool_calls?:unknown}};
    try{
      data=await ollamaRequestJson(this.fetchImpl,this.baseUrl+"/api/chat",body,request.timeoutMs??this.timeoutMs) as typeof data;
    }catch(error){
      if(native&&error instanceof OllamaHttpError&&error.status===400&&/does not support tools/i.test(error.message)){
        this.noNativeTools.add(model.name);
        return this.chatOnce(model,request);
      }
      throw error;
    }
    const content=stripThinking(String(data.message?.content??""));
    const toolCalls=native?parseNativeToolCalls(data.message?.tool_calls):wantTools?parseToolProtocol(content,request.tools!):[];
    return{model:model.name,content,toolCalls,usedNativeTools:native};
  }

  /** Ask for JSON; on invalid output, give the same model one repair attempt. */
  async json<T=unknown>(request:ChatRequest&{validate?:(value:unknown)=>boolean}):Promise<{value:T;model:string}>{
    const format=request.json&&typeof request.json==="object"?request.json:true;
    const first=await this.chat({...request,json:format});
    const ok=(text:string):{ok:true;value:unknown}|{ok:false}=>{
      try{const value=extractJson(text);return !request.validate||request.validate(value)?{ok:true,value}:{ok:false};}
      catch{return{ok:false};}
    };
    const parsed=ok(first.content);
    if(parsed.ok)return{value:parsed.value as T,model:first.model};
    const repair=await this.chat({...request,model:first.model,json:format,messages:[
      ...request.messages,
      {role:"assistant",content:first.content.slice(0,4000)},
      {role:"user",content:"Your previous reply was not valid for the required JSON format. Reply again with ONLY the corrected JSON, no explanation."}
    ]});
    const repaired=ok(repair.content);
    if(repaired.ok)return{value:repaired.value as T,model:repair.model};
    throw new Error(`Model ${first.model} did not return valid JSON after one repair attempt.`);
  }

  async embed(texts:string[]):Promise<{model:string;vectors:number[][]}>{
    await this.ensureFresh();
    const model=this.candidates("embedding")[0];
    if(!model)throw new NoSuitableModelError("embedding",noModelMessage("embedding",this.discovery,this.machine));
    const data=await ollamaRequestJson(this.fetchImpl,this.baseUrl+"/api/embed",{model:model.name,input:texts},this.timeoutMs) as {embeddings?:number[][]};
    return{model:model.name,vectors:data.embeddings??[]};
  }
}
