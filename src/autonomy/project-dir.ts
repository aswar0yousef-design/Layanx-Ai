import path from "node:path";
import {linkedProjectPath} from "../platform/linked-projects.js";

/** The folder a project lives in: a linked folder (e.g. open in VS Code) or <workspace root>/<project>. */
export function projectDir(projectId:string|undefined,env:NodeJS.ProcessEnv=process.env):string{
  const id=(projectId??"").trim();
  if(!id||id==="."||id===".."||/[\\/]/.test(id))throw new Error("Invalid project workspace identity.");
  return linkedProjectPath(id,env)??path.resolve(env.LAYANX_WORKSPACE_ROOT??process.cwd(),id);
}
