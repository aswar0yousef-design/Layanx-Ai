import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRuntime} from "../src/runtime.js";

const dir=await mkdtemp(join(tmpdir(),"layanx-ollama-e2e-"));
const storagePath=join(dir,"runtime.json");

try{
 const runtime=createRuntime({storagePath});
 const health=await (await import("../src/runtime.js")).runtimeHealth(runtime);
 const ollama=health.providers.find(provider=>provider.provider==="ollama");
 if(!ollama?.available){
  console.error(JSON.stringify({ok:false,stage:"health",message:"Ollama is not available. Start Ollama and install the configured model.",health},null,2));
  process.exitCode=2;
 }else{
  const result=await runtime.core.runAgentGateway(
   "Read the LayanX runtime status using the runtime.status tool and return the observed runtime status.",
   "ollama-e2e",
   5,
   {},
   "core"
  );
  if(!result.completed)throw new Error("Real Ollama mission did not complete: "+JSON.stringify(result));
  const persisted=await runtime.persistence?.get(result.missionId);
  if(!persisted||persisted.mission.status!=="completed"||persisted.executionState.status!=="completed")
   throw new Error("Completed Ollama mission was not persisted.");

  const restarted=createRuntime({storagePath});
  const hydration=await (await import("../src/runtime.js")).restoreRuntime(restarted);
  const restored=await restarted.persistence?.get(result.missionId);
  if(!restored||restored.mission.status!=="completed"||restored.executionState.status!=="completed")
   throw new Error("Completed mission was not available after runtime restart.");

  console.log(JSON.stringify({
   ok:true,
   stage:"ollama->planner->mission->agent-loop->tool->verification->persistence->restart",
   provider:ollama.provider,
   missionId:result.missionId,
   status:restored.mission.status,
   executionStatus:restored.executionState.status,
   steps:result.steps,
   hydratedSnapshots:hydration.restored
  },null,2));
 }
}finally{
 await rm(dir,{recursive:true,force:true});
}
