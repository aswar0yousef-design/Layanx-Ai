import type {LayanXCore} from "./core/orchestrator.js";
import type {ToolRequest} from "./core/types.js";
import {createAgentReachAdapter,agentReachSupportedChannels} from "./connectors/agent-reach.js";
import {webSearch} from "./autonomy/task-research.js";
import {findLeads,siteFrom} from "./business/lead-research.js";

export function registerAgentReachTools(core:LayanXCore):void{
  const raw=createAgentReachAdapter();
  // The planner may pick any of a tool's declared actions (English or Arabic); the connector only
  // understands one canonical action per tool. Map by tool name so every declared action works.
  const CANONICAL:Record<string,string>={
    "agent-reach.status":"agent reach status","agent-reach.channels":"agent reach channels",
    "agent-reach.update.check":"agent reach update check","agent-reach.collect":"agent reach collect",
    "research.internet":"agent reach research","agent-reach.setup":"agent reach setup"
  };
  const adapter={execute:(request:ToolRequest)=>raw.execute(CANONICAL[request.tool]?{...request,action:CANONICAL[request.tool]!}:request)};

  core.tools.register({
    name:"agent-reach.status",
    description:"inspect Agent Reach channel health and active backends without changing the machine",
    permission:"L1_READ",
    dangerous:false,
    actions:["agent reach status","agent reach doctor","فحص Agent Reach","فحص الوصول للإنترنت"],
    tags:["agent-reach","internet","research","health","doctor"]
  });
  core.toolAdapters.register("agent-reach.status",adapter);

  core.tools.register({
    name:"agent-reach.channels",
    description:"list the machine-readable Agent Reach channel registry",
    permission:"L1_READ",
    dangerous:false,
    actions:["agent reach channels","list internet channels","قنوات Agent Reach"],
    tags:["agent-reach","internet","channels","research"]
  });
  core.toolAdapters.register("agent-reach.channels",adapter);

  core.tools.register({
    name:"agent-reach.update.check",
    description:"check whether the installed Agent Reach version has an available update",
    permission:"L1_READ",
    dangerous:false,
    actions:["check Agent Reach update","check internet tools update","فحص تحديث Agent Reach"],
    tags:["agent-reach","update","maintenance"]
  });
  core.toolAdapters.register("agent-reach.update.check",adapter);

  core.tools.register({
    name:"agent-reach.collect",
    description:"collect bounded read-only research data through Agent Reach's supported channel router",
    permission:"L2_ANALYZE",
    dangerous:false,
    actions:["search internet","read internet source","collect web research","بحث الإنترنت","البحث في الإنترنت","قراءة مصدر"],
    tags:["agent-reach","internet","research","search","read","social","youtube","github"]
  });
  core.toolAdapters.register("agent-reach.collect",adapter);

  core.tools.register({
    name:"research.internet",
    description:"search the internet and collect read-only research (Agent Reach channels when installed, otherwise a web search). payload.query = the words to search for.",
    permission:"L2_ANALYZE",
    dangerous:false,
    actions:["research internet","deep research internet","search across internet","بحث شامل في الإنترنت","بحث شامل"],
    tags:["research","internet","agent-reach","search","web","social","github","youtube","leads","customers","market","competitors"]
  });
  core.toolAdapters.register("research.internet",{execute:request=>researchWithFallback(request,adapter)});

  // "Find potential customers for my site": read the site, work out who buys it, search for real companies of each type.
  core.tools.register({
    name:"research.leads",
    description:"find potential customers (leads) for a website or business: reads the site, works out which kinds of companies buy it, searches the web for real companies of each kind and lists them with their links. payload.site = the website address.",
    permission:"L2_ANALYZE",
    dangerous:false,
    actions:["find leads","find potential customers","البحث عن عملاء محتملين","عملاء محتملين"],
    tags:["leads","customers","prospects","sales","market","research","internet","عملاء"]
  });
  core.toolAdapters.register("research.leads",{async execute(request:ToolRequest){
    const site=siteFrom(request.payload);
    if(!site)throw new Error("research.leads needs payload.site: the website address, for example layanx.com.");
    const p=request.payload&&typeof request.payload==="object"?request.payload as Record<string,unknown>:{};
    return findLeads({site,request:typeof p.goal==="string"?p.goal:typeof p.request==="string"?p.request:""},{
      think:async(prompt,schema)=>(await core.modelExecution.execute({capability:"reasoning",input:prompt,maxOutputTokens:1500,responseSchema:schema,routing:{preferLocal:true}} as never)).output
    });
  }});

  core.tools.register({
    name:"agent-reach.setup",
    description:"prepare or install Agent Reach and its approved external research dependencies; system installation requires explicit approval",
    permission:"L4_EXECUTE",
    dangerous:true,
    actions:["setup Agent Reach","install Agent Reach","configure internet research","تثبيت Agent Reach","تجهيز الوصول للإنترنت"],
    tags:["agent-reach","setup","install","dependencies","system"]
  });
  core.toolAdapters.register("agent-reach.setup",adapter);

  // Keep the capability list discoverable without creating a second registry.
  core.tools.register({
    name:"agent-reach.capabilities",
    description:"read the supported Agent Reach channel names exposed by this LayanX integration",
    permission:"L1_READ",
    dangerous:false,
    actions:["list Agent Reach capabilities","Agent Reach capabilities","قدرات Agent Reach"],
    tags:["agent-reach","capabilities","research"]
  });
  core.toolAdapters.register("agent-reach.capabilities",{
    async execute():Promise<unknown>{
      return {channels:agentReachSupportedChannels.slice().sort(),readOnlyCollection:true,writeOperations:false};
    }
  });
}

/** The search words, whatever field the planner put them in ("query", "q", "topic", "search", "prompt"). */
export function researchQuery(payload:unknown):string{
  const p=payload&&typeof payload==="object"?payload as Record<string,unknown>:{};
  for(const key of ["query","q","topic","search","prompt","goal"])if(typeof p[key]==="string"&&(p[key] as string).trim())return (p[key] as string).trim().slice(0,4000);
  return "";
}
/**
 * Internet research through Agent Reach when it is installed; otherwise a plain web search, so "find leads for my site"
 * still returns results instead of failing ten times on a program that is not there. The result says which was used.
 */
export async function researchWithFallback(request:ToolRequest,adapter:{execute:(r:ToolRequest)=>Promise<unknown>},search:typeof webSearch=webSearch):Promise<unknown>{
  const query=researchQuery(request.payload);
  if(!query)throw new Error("research.internet needs payload.query: the words to search for.");
  const withQuery={...request,payload:{...(request.payload as Record<string,unknown>??{}),query}};
  try{return await adapter.execute(withQuery);}
  catch(error){
    const message=error instanceof Error?error.message:String(error);
    if(!/ENOENT|not installed|not found|is not recognized/i.test(message))throw error;
    const hits=await search(query);
    return{query,source:"web search (Agent Reach is not installed; agent-reach.setup installs it)",results:hits.slice(0,10)};
  }
}
