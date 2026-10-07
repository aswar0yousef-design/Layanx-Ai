import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Linked projects: a project ID that points at an existing folder anywhere on the PC
 * (for example the folder open in VS Code), instead of <workspace root>/<project ID>.
 * Stored in LAYANX_PROJECTS_FILE as {"projectid": "C:\\Users\\me\\code\\shop"}.
 * Only the owner on this computer can add links (see /v1/projects/link).
 */
let cache:{file:string;mtime:number;map:Record<string,string>}|null=null;

function key(projectId:string):string{
  const k=projectId.trim().normalize("NFKC");
  return process.platform==="win32"?k.toLowerCase():k;
}
function load(file:string):Record<string,string>{
  try{
    const stat=fs.statSync(file);
    if(cache&&cache.file===file&&cache.mtime===stat.mtimeMs)return cache.map;
    const map=JSON.parse(fs.readFileSync(file,"utf8")) as Record<string,string>;
    cache={file,mtime:stat.mtimeMs,map:map&&typeof map==="object"?map:{}};
    return cache.map;
  }catch{return {};}
}

export function linkedProjectPath(projectId:string,env:NodeJS.ProcessEnv=process.env):string|undefined{
  const file=env.LAYANX_PROJECTS_FILE;
  if(!file)return undefined;
  const target=load(file)[key(projectId)];
  return target&&path.isAbsolute(target)?path.resolve(target):undefined;
}

export function listLinkedProjects(env:NodeJS.ProcessEnv=process.env):Array<{projectId:string;path:string}>{
  const file=env.LAYANX_PROJECTS_FILE;
  return file?Object.entries(load(file)).map(([projectId,p])=>({projectId,path:p})):[];
}

/** Refuses folders that would hand the agent far more than one project. */
export function assertLinkableFolder(folder:string):string{
  if(!path.isAbsolute(folder))throw new Error("The folder path must be absolute.");
  const resolved=path.resolve(folder);
  let stat:fs.Stats;
  try{stat=fs.statSync(resolved);}catch{throw new Error("The folder does not exist.");}
  if(!stat.isDirectory())throw new Error("The path is not a folder.");
  const lower=(p:string)=>process.platform==="win32"?p.toLowerCase():p;
  const r=lower(resolved);
  if(path.parse(resolved).root===resolved)throw new Error("A whole drive cannot be a project.");
  const blocked=[os.homedir(),process.env.SystemRoot,process.env.ProgramFiles,process.env["ProgramFiles(x86)"],process.env.ProgramData,process.env.LOCALAPPDATA,process.env.APPDATA,"/etc","/usr","/bin","/System","/Library"].filter(Boolean).map(p=>lower(path.resolve(p!)));
  for(const b of blocked){
    if(r===b)throw new Error("This folder is too broad to be a project.");
    if(b!==lower(os.homedir())&&(r+path.sep).startsWith(b+path.sep))throw new Error("System folders cannot be projects.");
  }
  if(/[\\/]\.ssh([\\/]|$)|[\\/]\.gnupg([\\/]|$)/i.test(resolved))throw new Error("Credential folders cannot be projects.");
  return resolved;
}

/** Thrown when a project ID already points at another folder (trust and isolation follow the ID). */
export class ProjectIdTakenError extends Error{constructor(readonly projectId:string,readonly existing:string){super(`The project name "${projectId}" is already linked to ${existing}. Choose another name, or replace that link on purpose.`);}}

export function linkProject(file:string,projectId:string,folder:string,options:{replace?:boolean}={}):{projectId:string;path:string}{
  const id=projectId.trim();
  if(!id||id.length>64||/[\\/]|^\.\.?$/.test(id))throw new Error("Invalid project ID.");
  const resolved=assertLinkableFolder(folder);
  const map={...load(file)};
  const existing=map[key(id)];
  const same=(a:string,b:string)=>process.platform==="win32"?a.toLowerCase()===b.toLowerCase():a===b;
  // Never re-point a project silently: its trust level and isolation would move to the other folder.
  if(existing&&!same(existing,resolved)&&!options.replace)throw new ProjectIdTakenError(key(id),existing);
  map[key(id)]=resolved;
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const tmp=file+".tmp-"+process.pid;
  fs.writeFileSync(tmp,JSON.stringify(map,null,2),{mode:0o600});
  fs.renameSync(tmp,file);
  cache=null;
  return{projectId:key(id),path:resolved};
}

export function unlinkProject(file:string,projectId:string):boolean{
  const map={...load(file)};
  if(!(key(projectId) in map))return false;
  delete map[key(projectId)];
  fs.writeFileSync(file,JSON.stringify(map,null,2),{mode:0o600});
  cache=null;
  return true;
}
