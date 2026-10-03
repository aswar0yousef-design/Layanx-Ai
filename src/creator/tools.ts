import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolAdapter} from "../tools/executor.js";
import type {CreatorEngine} from "./engine.js";
export function registerCreatorTools(core:LayanXCore,creator:CreatorEngine){
 const defs=[["creator.doctor","check local content-generation dependencies","L1_READ",false],["creator.plan","create a verified short-video production plan","L2_ANALYZE",false],["creator.generate_assets","generate one visual asset per scene and optional local voice audio","L3_MODIFY",false],["creator.render","render planned scene assets into an MP4","L3_MODIFY",false]] as const;
 const handlers:Record<string,(p:any)=>Promise<unknown>|unknown>={"creator.doctor":()=>creator.doctor(),"creator.plan":p=>creator.plan(p),"creator.generate_assets":p=>creator.generateAssets(String(p.projectId)),"creator.render":p=>creator.render(String(p.projectId),p.outputPath?String(p.outputPath):undefined)};
 for(const [name,description,permission,dangerous] of defs){core.tools.register({name,description,permission:permission as any,dangerous,actions:[name],tags:["creator","media"]});const adapter:ToolAdapter={async execute(request){const fn=handlers[name]; if(!fn) throw new Error("Unknown creator tool"); return fn(request.payload??{});}};core.toolAdapters.register(name,adapter);}
}
