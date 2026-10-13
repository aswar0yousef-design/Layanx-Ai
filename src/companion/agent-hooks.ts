import crypto from "node:crypto";
import path from "node:path";

/**
 * Coding agents running on this PC outside LayanX (Claude Code, Codex): their hooks report what they do,
 * and their permission prompts can be answered from the phone or the screen-top island.
 *
 * The rule (same as Coucou's, whose approach this follows): nothing that allows anything is ever sent
 * back without a decision the owner made. With no decision (LayanX closed, nobody answered in time,
 * the owner answered in the terminal) the hook prints nothing and the agent asks in its own terminal,
 * exactly as if LayanX were not installed.
 */
export type HookAgent="claude"|"codex";
export const HOOK_AGENTS:readonly HookAgent[]=["claude","codex"];

export interface AgentSession{
  id:string;agent:HookAgent;cwd:string;project:string;
  status:"working"|"waiting"|"idle"|"ended";
  lastTool?:string;lastDetail?:string;lastEvent:string;prompt?:string;
  edits:number;startedAt:string;updatedAt:string;
}
export interface AgentPermission{id:string;agent:HookAgent;sessionId:string;project:string;tool:string;detail:string;createdAt:string;expiresAt:string;digest:string}

type Decision="allow"|"deny";
interface Waiting{permission:AgentPermission;resolve:(d:Decision|null)=>void}

const clean=(v:unknown,n:number)=>String(v??"").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g," ").replace(/\s+/g," ").trim().slice(0,n);
const EDIT_TOOLS=new Set(["Edit","Write","MultiEdit","NotebookEdit","apply_patch"]);
/** The folder name, for Windows (C:\\code\\shop) and POSIX paths alike. */
const folderName=(p:string)=>path.win32.basename(p.replace(/[\\/]+$/,""));

/** One short, readable line for what a tool is about to do (never the whole input). */
export function toolDetail(tool:string,input:unknown):string{
  const i=(input&&typeof input==="object"?input:{}) as Record<string,unknown>;
  const pick=i.command??i.cmd??i.file_path??i.path??i.notebook_path??i.url??i.pattern??i.description??i.query;
  if(Array.isArray(pick))return clean(pick.join(" "),400);
  if(pick!==undefined)return clean(pick,400);
  try{return clean(JSON.stringify(i),400);}catch{return"";}
}
export const permissionDigest=(p:{id:string;tool:string;detail:string;sessionId:string})=>
  crypto.createHash("sha256").update([p.id,p.sessionId,p.tool,p.detail].join("\u0000")).digest("hex").slice(0,16);

/** The documented PermissionRequest answer (Claude Code and Codex share it). */
export function decisionStdout(decision:Decision):string{
  return JSON.stringify({hookSpecificOutput:{hookEventName:"PermissionRequest",decision:decision==="allow"?{behavior:"allow"}:{behavior:"deny",message:"Denied by the owner from LayanX"}}});
}

export class AgentHookHub{
  private readonly sessionsById=new Map<string,AgentSession>();
  private readonly waiting=new Map<string,Waiting>();
  private readonly listeners=new Set<()=>void>();
  private readonly now:()=>number;
  private readonly waitMs:number;
  version=0;
  constructor(options:{now?:()=>number;waitMs?:number}={}){
    this.now=options.now??Date.now;
    // Below the relay's 115 s and Claude Code's 120 s hook timeout, so the hook always ends cleanly.
    this.waitMs=options.waitMs??100_000;
  }
  onChange(listener:()=>void):()=>void{this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  private changed(){this.version++;for(const l of this.listeners)try{l();}catch{}}

  sessions():AgentSession[]{
    const cutoff=this.now()-30*60_000;
    for(const [id,s] of this.sessionsById)if(Date.parse(s.updatedAt)<cutoff&&!this.hasWaiting(id))this.sessionsById.delete(id);
    return[...this.sessionsById.values()].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).map(s=>({...s}));
  }
  pending():AgentPermission[]{return[...this.waiting.values()].map(w=>({...w.permission}));}
  private hasWaiting(sessionId:string){for(const w of this.waiting.values())if(w.permission.sessionId===sessionId)return true;return false;}

  /** The owner's answer. False when the request is gone (answered, timed out) or the digest does not match. */
  decide(id:string,digest:string,decision:Decision):boolean{
    const w=this.waiting.get(id);
    if(!w||w.permission.digest!==digest)return false;
    this.waiting.delete(id);
    w.resolve(decision);
    return true;
  }

  /** One hook event; resolves to what the hook must print (often nothing). */
  async handle(agent:HookAgent,payload:Record<string,unknown>):Promise<string>{
    const event=clean(payload.hook_event_name??payload.event,40);
    const sessionId=clean(payload.session_id??payload.sessionId,80)||"unknown";
    if(!event)return"";
    const nowIso=new Date(this.now()).toISOString();
    const cwd=clean(payload.cwd,300);
    let s=this.sessionsById.get(sessionId);
    if(!s){
      if(this.sessionsById.size>=60){const oldest=this.sessions().at(-1);if(oldest)this.sessionsById.delete(oldest.id);}
      s={id:sessionId,agent,cwd,project:cwd?folderName(cwd):"",status:"working",lastEvent:event,edits:0,startedAt:nowIso,updatedAt:nowIso};
      this.sessionsById.set(sessionId,s);
    }
    s.updatedAt=nowIso;s.lastEvent=event;
    if(cwd){s.cwd=cwd;s.project=folderName(cwd);}
    const tool=clean(payload.tool_name,60);
    if(event!=="PermissionRequest"){
      // Anything else from this session means its prompt was answered elsewhere (in the terminal).
      for(const [id,w] of this.waiting)if(w.permission.sessionId===sessionId){this.waiting.delete(id);w.resolve(null);}
    }
    switch(event){
      case"SessionStart":s.status="working";break;
      case"UserPromptSubmit":s.status="working";s.prompt=clean(payload.prompt,160);break;
      case"PreToolUse":s.status="working";s.lastTool=tool;s.lastDetail=toolDetail(tool,payload.tool_input);break;
      case"PostToolUse":case"PostToolUseFailure":s.status="working";s.lastTool=tool;if(EDIT_TOOLS.has(tool))s.edits++;break;
      case"Stop":case"SubagentStop":case"StopFailure":case"Interrupt":s.status="idle";break;
      case"SessionEnd":s.status="ended";break;
      case"Notification":break;
      case"PermissionRequest":break;
      default:break;
    }
    if(event!=="PermissionRequest"||!tool||tool==="AskUserQuestion"){this.changed();return"";}
    // A permission prompt: wait for the owner (phone or island), then answer the agent.
    if(this.waiting.size>=40){this.changed();return"";}
    const id="ag_"+crypto.randomBytes(8).toString("hex");
    const detail=toolDetail(tool,payload.tool_input);
    const permission:AgentPermission={id,agent,sessionId,project:s.project,tool,detail,createdAt:nowIso,expiresAt:new Date(this.now()+this.waitMs).toISOString(),digest:""};
    permission.digest=permissionDigest(permission);
    s.status="waiting";s.lastTool=tool;s.lastDetail=detail;
    const decision=await new Promise<Decision|null>(resolve=>{
      const timer=setTimeout(()=>{if(this.waiting.delete(id)){resolve(null);this.changed();}},this.waitMs);
      this.waiting.set(id,{permission,resolve:d=>{clearTimeout(timer);resolve(d);}});
      this.changed();
    });
    const current=this.sessionsById.get(sessionId);
    if(current&&current.status==="waiting"&&!this.hasWaiting(sessionId))current.status="working";
    this.changed();
    return decision?decisionStdout(decision):"";
  }
}
