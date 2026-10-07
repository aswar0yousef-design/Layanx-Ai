import fs from "node:fs";
import path from "node:path";

/**
 * Per-project trust levels: how much the agent may do without asking.
 *
 *   supervised : every dangerous action waits for the owner (default)
 *   trusted    : reversible work inside the project runs alone (edit files, install, test,
 *                build, dev server, local commits/branches, browser tests, local coding agents)
 *   full       : trusted + desktop control (mouse/keyboard) and cloud coding agents
 *
 * NEVER automatic at any level: git push, publishing, sending email, ads, trading, payments,
 * installing tools on the machine. Those always wait for the owner.
 */
export type TrustLevel="supervised"|"trusted"|"full";
export const TRUST_LEVELS:TrustLevel[]=["supervised","trusted","full"];

const TRUSTED=new Set(["files.write","project.run","project.verify","project.bootstrap","browser.test","terminal.exec",
  "git.add","git.commit","git.branch","git.rollback","git.checkpoint","agent.external.local"]);
const FULL=new Set([...TRUSTED,"git.merge","desktop.mouse.move","desktop.mouse.click","desktop.mouse.scroll","desktop.keyboard.type","desktop.keyboard.press","desktop.ui.click","desktop.ui.set_text","desktop.window.focus","agent.external"]);

let cache:{file:string;mtime:number;map:Record<string,TrustLevel>}|null=null;
function load(file:string):Record<string,TrustLevel>{
  try{
    const stat=fs.statSync(file);
    if(cache&&cache.file===file&&cache.mtime===stat.mtimeMs)return cache.map;
    const raw=JSON.parse(fs.readFileSync(file,"utf8")) as Record<string,unknown>;
    const map:Record<string,TrustLevel>={};
    for(const [k,v] of Object.entries(raw))if(TRUST_LEVELS.includes(v as TrustLevel))map[k.toLowerCase()]=v as TrustLevel;
    cache={file,mtime:stat.mtimeMs,map};
    return map;
  }catch{return{};}
}

export function trustLevel(projectId:string|undefined,env:NodeJS.ProcessEnv=process.env):TrustLevel{
  const file=env.LAYANX_TRUST_FILE;
  const fromFile=file&&projectId?load(file)[projectId.trim().toLowerCase()]:undefined;
  if(fromFile)return fromFile;
  const d=env.LAYANX_DEFAULT_TRUST;
  return TRUST_LEVELS.includes(d as TrustLevel)?d as TrustLevel:"supervised";
}

/** Whether a dangerous tool may run without an approval in this project. `variant` distinguishes local/cloud agents. */
export function trustAllows(tool:string,projectId:string|undefined,env:NodeJS.ProcessEnv=process.env,variant?:string):boolean{
  const level=trustLevel(projectId,env);
  if(level==="supervised")return false;
  const key=variant?tool+"."+variant:tool;
  return (level==="full"?FULL:TRUSTED).has(key)||(level==="full"?FULL:TRUSTED).has(tool);
}

export function setTrust(file:string,projectId:string,level:TrustLevel):void{
  if(!TRUST_LEVELS.includes(level))throw new Error("Invalid trust level.");
  const map={...load(file)};
  map[projectId.trim().toLowerCase()]=level;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify(map,null,2),{mode:0o600});
  cache=null;
}
export function listTrust(file:string|undefined):Record<string,TrustLevel>{return file?{...load(file)}:{};}
