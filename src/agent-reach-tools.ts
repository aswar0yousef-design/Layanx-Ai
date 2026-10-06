import type {LayanXCore} from "./core/orchestrator.js";
import type {ToolRequest} from "./core/types.js";
import {createAgentReachAdapter,agentReachSupportedChannels} from "./connectors/agent-reach.js";

export function registerAgentReachTools(core:LayanXCore):void{
  const adapter=createAgentReachAdapter();

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
    actions:["research internet","search internet","read internet source","collect web research","بحث الإنترنت","البحث في الإنترنت","قراءة مصدر"],
    tags:["agent-reach","internet","research","search","read","social","youtube","github"]
  });
  core.toolAdapters.register("agent-reach.collect",adapter);

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
