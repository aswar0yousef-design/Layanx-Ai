import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {writeFileAtomic} from "../platform/paths.js";
import type {HookAgent} from "./agent-hooks.js";

/**
 * Puts LayanX's hook relay into Claude Code's settings.json (or Codex's hooks.json) and takes it out
 * again. The rule, as in Coucou: read the file, show the owner the exact change (a diff), take a dated
 * backup, and write only the change the owner looked at (its fingerprint). Nobody else's hooks are
 * touched; anything of an unexpected shape is refused rather than replaced. Uninstall removes LayanX's
 * entries and nothing else.
 */
const MARKER="layanx-hook";

/** Each event the island and the phone follow; PermissionRequest waits for the owner (relay 115 s). */
const EVENTS:Record<HookAgent,Array<[string,number]>>={
  claude:[["SessionStart",10],["SessionEnd",10],["UserPromptSubmit",10],["PreToolUse",10],["PostToolUse",10],["PermissionRequest",120],["Notification",10],["Stop",10],["SubagentStop",10]],
  codex:[["SessionStart",10],["UserPromptSubmit",10],["PreToolUse",10],["PermissionRequest",120],["PostToolUse",10],["Stop",10],["SubagentStop",10],["SessionEnd",3]]
};

export function hookFile(agent:HookAgent,home=os.homedir()):string{
  return agent==="claude"?path.join(home,".claude","settings.json"):path.join(home,".codex","hooks.json");
}

/**
 * The command line for the relay. Claude Code runs hooks through Git Bash on Windows (one quoted word,
 * forward slashes); Codex through cmd /C (a quoted program name keeps its quotes when it is the only
 * quoted word). The agent name follows; both put the event name in the payload.
 */
export function hookCommand(agent:HookAgent,exe:string,platform:NodeJS.Platform=process.platform):string{
  if(platform!=="win32")return `'${exe.replace(/'/g,"'\\''")}' ${agent}`;
  if(agent==="claude")return `"${exe.replace(/\\/g,"/")}" ${agent}`;
  return /^[A-Za-z0-9_:\\/.-]+$/.test(exe)?`${exe} ${agent}`:`"${exe}" ${agent}`;
}

type Json=Record<string,unknown>;
const isObject=(v:unknown):v is Json=>!!v&&typeof v==="object"&&!Array.isArray(v);
const ours=(group:unknown)=>isObject(group)&&Array.isArray(group.hooks)&&group.hooks.some(h=>isObject(h)&&typeof h.command==="string"&&h.command.includes(MARKER));

/** The new file content, or an error when the file is not what the agent documents. */
export function mergeHooks(root:unknown,agent:HookAgent,command:string|null):{ok:true;value:Json}|{ok:false;error:string}{
  if(root!==undefined&&!isObject(root))return{ok:false,error:"The file is not a JSON object; LayanX has not touched it."};
  const out:Json={...(root as Json|undefined)};
  if(out.hooks!==undefined&&!isObject(out.hooks))return{ok:false,error:"\"hooks\" has an unexpected type; LayanX has not touched it."};
  const hooks:Json={...(out.hooks as Json|undefined)};
  const events=new Set(EVENTS[agent].map(([e])=>e));
  for(const [event,value] of Object.entries(hooks)){
    if(!Array.isArray(value)){if(events.has(event))return{ok:false,error:`"hooks"."${event}" has an unexpected type; LayanX has not touched it.`};continue;}
    const kept=value.filter(g=>!ours(g));
    if(kept.length)hooks[event]=kept;else delete hooks[event];
  }
  if(command){
    for(const [event,timeout] of EVENTS[agent]){
      const hook:Json={type:"command",command,timeout};
      if(agent==="codex"&&event==="PermissionRequest")hook.statusMessage="Waiting for your answer in LayanX (phone or screen-top island)";
      hooks[event]=[...((hooks[event] as unknown[]|undefined)??[]),{hooks:[hook]}];
    }
  }
  if(Object.keys(hooks).length)out.hooks=hooks;else delete out.hooks;
  return{ok:true,value:out};
}

/** A plain line diff (the files are small): lines only in the old file start with "-", new ones with "+". */
export function lineDiff(before:string,after:string):string{
  const a=before?before.split("\n"):[],b=after.split("\n");
  const n=a.length,m=b.length;
  const lcs=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)lcs[i]![j]=a[i]===b[j]?lcs[i+1]![j+1]!+1:Math.max(lcs[i+1]![j]!,lcs[i]![j+1]!);
  const out:string[]=[];let i=0,j=0;
  while(i<n||j<m){
    if(i<n&&j<m&&a[i]===b[j]){out.push("  "+a[i]);i++;j++;}
    else if(i<n&&(j>=m||lcs[i+1]![j]!>=lcs[i]![j+1]!)){out.push("- "+a[i]);i++;}
    else{out.push("+ "+b[j]);j++;}
  }
  return out.join("\n");
}

export interface HookPlan{agent:HookAgent;action:"install"|"remove";file:string;exists:boolean;installedNow:boolean;changes:boolean;diff:string;fingerprint:string;backup:string|null;error?:string}

function readCurrent(file:string):{bytes:Buffer|null;json:unknown;error?:string}{
  let bytes:Buffer|null=null;
  try{bytes=fs.readFileSync(file);}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")return{bytes:null,json:undefined,error:"Cannot read "+file};}
  if(!bytes||!bytes.toString("utf8").trim())return{bytes,json:undefined};
  try{return{bytes,json:JSON.parse(bytes.toString("utf8").replace(/^﻿/,""))};}catch{return{bytes,json:undefined,error:`${path.basename(file)} is not valid JSON; LayanX has not touched it.`};}
}
const fingerprintOf=(bytes:Buffer|null)=>crypto.createHash("sha256").update(bytes??Buffer.from("<absent>")).digest("hex").slice(0,24);
const stamp=(d:Date)=>d.toISOString().replace(/[-:]/g,"").replace("T","-").slice(0,15);

export function installed(agent:HookAgent,home=os.homedir()):boolean{
  const cur=readCurrent(hookFile(agent,home));
  return isObject(cur.json)&&isObject(cur.json.hooks)&&Object.values(cur.json.hooks).some(v=>Array.isArray(v)&&v.some(ours));
}

/** What would change, for the owner to look at before anything is written. */
export function planHooks(agent:HookAgent,action:"install"|"remove",exe:string,options:{home?:string;platform?:NodeJS.Platform;now?:Date}={}):HookPlan{
  const file=hookFile(agent,options.home);
  const cur=readCurrent(file);
  const base={agent,action,file,exists:cur.bytes!==null,installedNow:installed(agent,options.home),fingerprint:fingerprintOf(cur.bytes)};
  if(cur.error)return{...base,changes:false,diff:"",backup:null,error:cur.error};
  const merged=mergeHooks(cur.json,agent,action==="install"?hookCommand(agent,exe,options.platform):null);
  if(!merged.ok)return{...base,changes:false,diff:"",backup:null,error:merged.error};
  const before=cur.bytes?JSON.stringify(cur.json??{},null,2):"";
  const after=JSON.stringify(merged.value,null,2);
  const changes=before!==after;
  return{...base,changes,diff:changes?lineDiff(before,after):"",backup:cur.bytes&&changes?`${file}.layanx-backup-${stamp(options.now??new Date())}`:null};
}

/** Writes the planned change, if the file is still exactly what the owner saw. */
export function applyHooks(agent:HookAgent,action:"install"|"remove",exe:string,fingerprint:string,options:{home?:string;platform?:NodeJS.Platform;now?:Date}={}):{ok:true;backup:string|null;file:string}|{ok:false;error:string}{
  const plan=planHooks(agent,action,exe,options);
  if(plan.error)return{ok:false,error:plan.error};
  if(plan.fingerprint!==fingerprint)return{ok:false,error:"The file changed since you looked at it. Look at the change again."};
  if(!plan.changes)return{ok:true,backup:null,file:plan.file};
  const cur=readCurrent(plan.file);
  const merged=mergeHooks(cur.json,agent,action==="install"?hookCommand(agent,exe,options.platform):null);
  if(!merged.ok)return{ok:false,error:merged.error};
  fs.mkdirSync(path.dirname(plan.file),{recursive:true});
  if(plan.backup&&cur.bytes)fs.writeFileSync(plan.backup,cur.bytes,{flag:"wx"});
  // A settings file kept elsewhere (dotfiles) and linked here: write the real file, keep the link.
  let target=plan.file;
  try{target=fs.realpathSync(plan.file);}catch{/* not there yet */}
  writeFileAtomic(target,JSON.stringify(merged.value,null,2)+"\n");
  return{ok:true,backup:plan.backup,file:plan.file};
}
