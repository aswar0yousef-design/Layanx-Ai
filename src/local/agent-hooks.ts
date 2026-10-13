import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {readJsonFile,writeFileAtomic} from "../platform/paths.js";

/**
 * Claude Code and Codex, run outside LayanX, ask for permission before risky steps. This
 * installs their PermissionRequest hook (scripts/agent-hook.mjs) so those questions reach
 * the owner's phone (fingerprint), the desktop island and the control center.
 *
 * Their settings file is copied to "<file>.layanx-backup-<time>" before every change, other
 * hooks and settings are kept as they are, and uninstall removes only what LayanX added.
 * A file that is not valid JSON is never touched.
 */
export type HookAgent="claude"|"codex";
export const HOOK_SCRIPT=fileURLToPath(new URL("../../scripts/agent-hook.mjs",import.meta.url));
const MARK="agent-hook.mjs";
const DEFAULT_WAIT=120;

export interface HookTarget{agent:HookAgent;label:string;file:string;dir:string}
export interface HookResult{agent:HookAgent;label:string;file:string;installed:boolean;changed:boolean;backup?:string;note?:string;error?:string}

export function hookTargets(env:NodeJS.ProcessEnv=process.env,home:string=os.homedir()):HookTarget[]{
  const claudeDir=env.CLAUDE_CONFIG_DIR?.trim()||path.join(home,".claude");
  const codexDir=env.CODEX_HOME?.trim()||path.join(home,".codex");
  return[
    {agent:"claude",label:"Claude Code",dir:claudeDir,file:path.join(claudeDir,"settings.json")},
    {agent:"codex",label:"Codex",dir:codexDir,file:path.join(codexDir,"hooks.json")}
  ];
}

const slash=(p:string)=>p.replace(/\\/g,"/");
/** Quoted with forward slashes: runs the same in Git Bash (Claude Code on Windows), cmd.exe (Codex) and POSIX shells. */
export function hookCommand(agent:HookAgent,o:{node:string;script:string;configFile:string;waitSeconds:number}):string{
  return `"${slash(o.node)}" "${slash(o.script)}" ${agent} "${slash(o.configFile)}" ${o.waitSeconds}`;
}

/** The token the hooks send (only lets them ask; see AccessManager.verifyHookToken), and the port. */
export function ensureHookToken(configFile:string,port:number):void{
  const current=readJsonFile<{token?:string;port?:number}>(configFile,{});
  const token=typeof current.token==="string"&&current.token.startsWith("lxh_")?current.token:"lxh_"+crypto.randomBytes(32).toString("base64url");
  if(current.token===token&&current.port===port)return;
  fs.mkdirSync(path.dirname(configFile),{recursive:true,mode:0o700});
  writeFileAtomic(configFile,JSON.stringify({port,token,note:"Used by the Claude Code / Codex hook to ask you through LayanX. Delete it to disconnect them."},null,2));
}

function readSettings(file:string):{exists:boolean;data:Record<string,unknown>}{
  if(!fs.existsSync(file))return{exists:false,data:{}};
  const text=fs.readFileSync(file,"utf8").replace(/^﻿/,"");
  if(!text.trim())return{exists:true,data:{}};
  let data:unknown;
  try{data=JSON.parse(text);}catch{throw new Error(`${file} is not valid JSON. Fix it (or move it away) first; nothing was changed.`);}
  if(!data||typeof data!=="object"||Array.isArray(data))throw new Error(`${file} does not hold a JSON object; nothing was changed.`);
  return{exists:true,data:data as Record<string,unknown>};
}

const stamp=(d:Date)=>d.toISOString().replace(/[-:T]/g,"").slice(0,14);
type Group={matcher?:string;hooks?:Array<Record<string,unknown>>};
const isOurs=(h:Record<string,unknown>)=>typeof h?.command==="string"&&h.command.includes(MARK);
function withoutOurs(groups:unknown):Group[]{
  if(!Array.isArray(groups))return[];
  return(groups as Group[]).map(g=>({...g,hooks:(Array.isArray(g?.hooks)?g.hooks:[]).filter(h=>!isOurs(h))})).filter(g=>(g.hooks?.length??0)>0);
}
function hasOurs(data:Record<string,unknown>):boolean{
  const groups=(data.hooks as Record<string,unknown>|undefined)?.PermissionRequest;
  return Array.isArray(groups)&&(groups as Group[]).some(g=>Array.isArray(g?.hooks)&&g.hooks.some(isOurs));
}

function write(target:HookTarget,exists:boolean,before:Record<string,unknown>,next:Record<string,unknown>,now:Date):{changed:boolean;backup?:string}{
  if(JSON.stringify(before)===JSON.stringify(next))return{changed:false};
  let backup:string|undefined;
  if(exists){backup=`${target.file}.layanx-backup-${stamp(now)}`;fs.copyFileSync(target.file,backup);}
  fs.mkdirSync(target.dir,{recursive:true});
  writeFileAtomic(target.file,JSON.stringify(next,null,2)+"\n");
  return{changed:true,...(backup?{backup}:{})};
}

export interface HookOptions{dataDir:string;port:number;agents?:HookAgent[];env?:NodeJS.ProcessEnv;home?:string;node?:string;script?:string;waitSeconds?:number;now?:()=>Date}
const configFileOf=(dataDir:string)=>path.join(dataDir,"agent-hooks.json");

/** Installs for the agents asked for, or for every agent whose settings folder exists. */
export function installAgentHooks(o:HookOptions):HookResult[]{
  const now=(o.now??(()=>new Date()))();
  const wait=Math.min(Math.max(o.waitSeconds??DEFAULT_WAIT,10),540);
  const configFile=configFileOf(o.dataDir);
  const targets=hookTargets(o.env,o.home).filter(t=>o.agents?o.agents.includes(t.agent):fs.existsSync(t.dir));
  if(targets.length)ensureHookToken(configFile,o.port);
  return targets.map(t=>{
    try{
      const {exists,data}=readSettings(t.file);
      const hooks=(data.hooks&&typeof data.hooks==="object"&&!Array.isArray(data.hooks)?data.hooks:{}) as Record<string,unknown>;
      const ours:Group={hooks:[{type:"command",command:hookCommand(t.agent,{node:o.node??process.execPath,script:o.script??HOOK_SCRIPT,configFile,waitSeconds:wait}),timeout:wait+30}]};
      const next={...data,hooks:{...hooks,PermissionRequest:[...withoutOurs(hooks.PermissionRequest),ours]}};
      const w=write(t,exists,data,next,now);
      return{agent:t.agent,label:t.label,file:t.file,installed:true,...w,
        ...(t.agent==="codex"?{note:"In Codex, open /hooks once and trust the LayanX hook (Codex runs a new hook only after you trust it)."}:{})};
    }catch(error){return{agent:t.agent,label:t.label,file:t.file,installed:false,changed:false,error:(error as Error).message};}
  });
}

/** Removes only LayanX's hook (backup first); other hooks and settings stay. */
export function uninstallAgentHooks(o:Omit<HookOptions,"port">&{port?:number}):HookResult[]{
  const now=(o.now??(()=>new Date()))();
  const results=hookTargets(o.env,o.home).filter(t=>!o.agents||o.agents.includes(t.agent)).flatMap(t=>{
    try{
      if(!fs.existsSync(t.file))return[];
      const {exists,data}=readSettings(t.file);
      if(!hasOurs(data))return[{agent:t.agent,label:t.label,file:t.file,installed:false,changed:false}];
      const hooks={...(data.hooks as Record<string,unknown>)};
      const left=withoutOurs(hooks.PermissionRequest);
      if(left.length)hooks.PermissionRequest=left;else delete hooks.PermissionRequest;
      const next={...data};
      if(Object.keys(hooks).length)next.hooks=hooks;else delete next.hooks;
      return[{agent:t.agent,label:t.label,file:t.file,installed:false,...write(t,exists,data,next,now)}];
    }catch(error){return[{agent:t.agent,label:t.label,file:t.file,installed:false,changed:false,error:(error as Error).message}];}
  });
  if(!o.agents||o.agents.length===2){try{fs.rmSync(configFileOf(o.dataDir),{force:true});}catch{}}
  return results;
}

export function agentHooksStatus(o:{dataDir:string;env?:NodeJS.ProcessEnv;home?:string}):Array<{agent:HookAgent;label:string;file:string;found:boolean;installed:boolean;error?:string}>{
  const tokenReady=fs.existsSync(configFileOf(o.dataDir));
  return hookTargets(o.env,o.home).map(t=>{
    try{const {data}=readSettings(t.file);return{agent:t.agent,label:t.label,file:t.file,found:fs.existsSync(t.dir),installed:tokenReady&&hasOurs(data)};}
    catch(error){return{agent:t.agent,label:t.label,file:t.file,found:fs.existsSync(t.dir),installed:false,error:(error as Error).message};}
  });
}
