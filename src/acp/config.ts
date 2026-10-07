import path from "node:path";
import {fileURLToPath} from "node:url";

/** Editor settings that start the LayanX ACP agent from this checkout (shown on the setup page). */
export function acpEditorConfig(repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..",".."),node=process.execPath){
  const args=[path.join(repoRoot,"node_modules","tsx","dist","cli.mjs"),path.join(repoRoot,"src","acp","main.ts")];
  return{command:node,args,
    zed:{agent_servers:{LayanX:{type:"custom",command:node,args,env:{}}}},
    jetbrains:{agent_servers:{LayanX:{command:node,args,env:{}}}}};
}
