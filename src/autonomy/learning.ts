import fs from "node:fs";
import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {projectDir} from "./project-dir.js";

/**
 * How LayanX gets better with use.
 *
 * LESSONS  short facts learned from work: "X failed with <error>; fixed by Y" (kind fix) or
 *          "this approach did not work" (kind pitfall). Matched by error signature (the same error
 *          seen again gets its known fix immediately) and by keywords/stack for planning.
 *
 * PLAYBOOKS how-to guides for a kind of task (steps, pitfalls, how to test). Three sources:
 *          builtin  shipped in /playbooks (reviewed)
 *          learned  written by LayanX after a successful job        -> candidate until the owner approves
 *          project  <project>/.layanx/playbooks, or skills in SKILL.md format (.layanx/skills, .claude/skills,
 *                   .agents/skills). Written by LayanX's own research during a job -> trusted in that project
 *                   after the safety scan. Anything that arrived with the files (a cloned repository, a
 *                   downloaded skill) is QUARANTINED as a candidate until the owner approves it, and any later
 *                   change to an approved file sends it back to quarantine (approval is tied to a content hash).
 *          Skills (SKILL.md, the agentskills.io format used by Claude, Codex and others) are read the same way;
 *          every file in the skill folder is scanned, because instructions may tell the agent to run its scripts.
 *          Every use is counted; a playbook used 5+ times with <40% success is switched off.
 *
 * Nothing learned can execute code by itself: playbooks and lessons are text the planner reads,
 * and everything still goes through permissions, approvals, tests and the security gate.
 */
export interface Lesson{id:string;at:string;projectId:string;stack:string;kind:"fix"|"pitfall";signature?:string;trigger:string;text:string;tags:string[];uses:number;helped:number}
export type PlaybookStatus="active"|"candidate"|"disabled"|"rejected";
export interface Playbook{id:string;title:string;tags:string[];stacks:string[];status:PlaybookStatus;source:"builtin"|"learned"|"project";body:string;file:string;uses:number;success:number;note?:string;format?:"playbook"|"skill";hash:string;scanText?:string}

const STOP=new Set(["the","and","for","with","that","this","from","into","your","you","are","was","have","has","use","using","make","add","new","all","not","but","can","any","then","than","when","what","which","will","should","must","only","each","more","in","on","of","to","a","an","is","it","be","by","or","as","at","في","من","على","الى","إلى","عن","مع","ثم","هذا","هذه","التي","الذي","كل","أن","ان","او","أو","لا","ما","هو","هي"]);
export function tokens(text:string):string[]{
  return[...new Set(text.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}.+#-]+/gu," ").split(/\s+/).map(w=>w.replace(/^[.-]+|[.-]+$/g,"")).filter(w=>w.length>=3&&!STOP.has(w)))];
}
/** Same error, different paths/line numbers/values -> same signature. */
export function errorSignature(text:string):string|undefined{
  const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(l=>/\b(error|fail(ed|ing)?|exception|traceback|cannot|not found|undefined|unexpected|TS\d{4}|ENOENT|EACCES|ERR_)\b/i.test(l)).slice(0,3);
  if(!lines.length)return undefined;
  return lines.join(" | ").replace(/([A-Za-z]:)?[\w./\\-]+\.(tsx?|jsx?|mjs|cjs|py|dart|cs|go|rs|java|vue|svelte|json|css|html)(:\d+)*(:\d+)?/g,"<file>")
    .replace(/\b0x[0-9a-f]+\b/gi,"N").replace(/\d+(\.\d+)?/g,"N").replace(/(['"`]).*?\1/g,"'…'").replace(/\s+/g," ").toLowerCase().slice(0,220);
}

const storeDir=(env:NodeJS.ProcessEnv=process.env)=>env.LAYANX_STORE_DIR?.trim()||".layanx";
const lessonsFile=(env:NodeJS.ProcessEnv=process.env)=>env.LAYANX_LESSONS_FILE||path.join(storeDir(env),"lessons.json");
const learnedDir=(env:NodeJS.ProcessEnv=process.env)=>env.LAYANX_PLAYBOOKS_DIR||path.join(storeDir(env),"playbooks");
const statsFile=(env:NodeJS.ProcessEnv=process.env)=>path.join(storeDir(env),"playbook-stats.json");
export const BUILTIN_PLAYBOOKS=fileURLToPath(new URL("../../playbooks/",import.meta.url));
const readJson=<T>(f:string,fb:T):T=>{try{return JSON.parse(fs.readFileSync(f,"utf8")) as T;}catch{return fb;}};
const writeJson=(f:string,v:unknown)=>{fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+".tmp";fs.writeFileSync(tmp,JSON.stringify(v,null,1));fs.renameSync(tmp,f);};

// ---------------------------------------------------------------- lessons
export function listLessons(env:NodeJS.ProcessEnv=process.env):Lesson[]{return readJson<Lesson[]>(lessonsFile(env),[]);}
export function recordLesson(input:Omit<Lesson,"id"|"at"|"uses"|"helped"|"tags">&{tags?:string[]},env:NodeJS.ProcessEnv=process.env):Lesson{
  const all=listLessons(env);
  const text=input.text.replace(/\s+/g," ").trim().slice(0,600);
  const existing=all.find(l=>l.projectId===input.projectId&&((input.signature&&l.signature===input.signature)||l.text===text));
  const lesson:Lesson=existing?{...existing,at:new Date().toISOString(),text,trigger:input.trigger.slice(0,300)}:
    {id:randomUUID(),at:new Date().toISOString(),projectId:input.projectId,stack:input.stack,kind:input.kind,...(input.signature?{signature:input.signature}:{}),trigger:input.trigger.slice(0,300),text,tags:[...new Set([...(input.tags??[]),...tokens(input.trigger+" "+text)])].slice(0,20),uses:0,helped:0};
  const next=existing?all.map(l=>l.id===existing.id?lesson:l):[lesson,...all].slice(0,500);
  writeJson(lessonsFile(env),next);
  try{const d=path.join(projectDir(input.projectId),".layanx");fs.mkdirSync(d,{recursive:true});const f=path.join(d,"LESSONS.md");if(!fs.existsSync(f))fs.writeFileSync(f,"# Lessons\n\nWhat LayanX learned while working on this project.\n");
    if(!existing)fs.appendFileSync(f,`\n- (${lesson.kind}, ${lesson.at.slice(0,10)}) ${text}\n`);}catch{}
  return lesson;
}
export function findLessons(q:{goal?:string;stack?:string;error?:string;projectId?:string},k=5,env:NodeJS.ProcessEnv=process.env):Lesson[]{
  const sig=q.error?errorSignature(q.error):undefined;
  const words=new Set(tokens((q.goal??"")+" "+(q.error??"").slice(0,800)));
  return listLessons(env).map(l=>{
    let score=0;
    if(sig&&l.signature===sig)score+=12;
    score+=l.tags.filter(t=>words.has(t)).length*1.5;
    if(q.stack&&l.stack===q.stack)score+=1.5;
    if(q.projectId&&l.projectId===q.projectId)score+=1;
    if(l.uses>=3&&l.helped/l.uses<0.3)score-=4;
    return{l,score};
  }).filter(x=>x.score>=3).sort((a,b)=>b.score-a.score).slice(0,k).map(x=>x.l);
}
export function markLessons(ids:string[],helped:boolean,env:NodeJS.ProcessEnv=process.env){
  if(!ids.length)return;
  writeJson(lessonsFile(env),listLessons(env).map(l=>ids.includes(l.id)?{...l,uses:l.uses+1,helped:l.helped+(helped?1:0)}:l));
}
export function deleteLesson(id:string,env:NodeJS.ProcessEnv=process.env){const all=listLessons(env);writeJson(lessonsFile(env),all.filter(l=>l.id!==id));return all.length!==listLessons(env).length;}

// ---------------------------------------------------------------- playbooks
const sha=(text:string)=>createHash("sha256").update(text).digest("hex");
type Parsed=Omit<Playbook,"uses"|"success">;
function frontmatter(raw:string):{meta:Record<string,string>;body:string}{
  const m=/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  const meta:Record<string,string>={};
  if(m)for(const line of m[1]!.split(/\r?\n/)){const i=line.indexOf(":");if(i>0)meta[line.slice(0,i).trim()]=line.slice(i+1).trim().replace(/^["']|["']$/g,"");}
  return{meta,body:(m?m[2]!:raw).trim()};
}
const list=(v?:string)=>(v??"").replace(/^\[|\]$/g,"").split(",").map(x=>x.trim().replace(/^["']|["']$/g,"").toLowerCase()).filter(Boolean);
function parse(file:string,source:Playbook["source"]):Parsed|null{
  let raw="";try{raw=fs.readFileSync(file,"utf8");}catch{return null;}
  const {meta,body}=frontmatter(raw);
  const status=(["active","candidate","disabled","rejected"].includes(meta.status??"")?meta.status:source==="learned"?"candidate":"active") as PlaybookStatus;
  return{id:(source==="project"?"project:":source==="learned"?"learned:":"builtin:")+path.basename(file,".md"),title:meta.title||path.basename(file,".md"),tags:list(meta.tags),stacks:list(meta.stacks),status,source,body,file,format:"playbook",hash:sha(raw),...(meta.note?{note:meta.note}:{})};
}
/** A skill folder (agentskills.io): SKILL.md with name + description, plus optional scripts/resources. */
function parseSkill(dir:string,source:Playbook["source"]):Parsed|null{
  const file=path.join(dir,"SKILL.md");
  let raw="";try{raw=fs.readFileSync(file,"utf8");}catch{return null;}
  const {meta,body}=frontmatter(raw);
  const name=(meta.name||path.basename(dir)).slice(0,80);
  // Every text file in the folder is part of what gets approved and scanned (max 300 KB).
  let extra="";let budget=300_000;
  const walk=(d:string,depth:number)=>{let entries:fs.Dirent[]=[];try{entries=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
    for(const e of entries.sort((a,b)=>a.name.localeCompare(b.name))){const f=path.join(d,e.name);
      if(e.isDirectory()){if(depth<4&&!e.name.startsWith(".")&&e.name!=="node_modules")walk(f,depth+1);continue;}
      if(f===file||!e.isFile())continue;
      try{const st=fs.statSync(f);if(st.size>budget)continue;const text=fs.readFileSync(f,"utf8");if(text.includes("\u0000"))continue;budget-=st.size;extra+="\n\n# "+path.relative(dir,f)+"\n"+text;}catch{}}};
  walk(dir,0);
  const description=meta.description??"";
  return{id:(source==="project"?"project:":source==="learned"?"learned:":"builtin:")+"skill-"+path.basename(dir),title:name,tags:tokens(name.replace(/-/g," ")+" "+description).slice(0,15),stacks:list(meta.stacks),
    status:source==="builtin"?"active":"candidate",source,body:(description?description+"\n\n":"")+body,file,format:"skill",hash:sha(raw+extra),scanText:raw+extra,...(meta.note?{note:meta.note}:{})};
}
const mdFiles=(dir:string)=>{try{return fs.readdirSync(dir).filter(f=>f.endsWith(".md")).map(f=>path.join(dir,f));}catch{return[];}};
const skillDirs=(dir:string)=>{try{return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()&&fs.existsSync(path.join(dir,e.name,"SKILL.md"))).map(e=>path.join(dir,e.name));}catch{return[];}};
const userSkillsDir=(env:NodeJS.ProcessEnv=process.env)=>env.LAYANX_SKILLS_DIR||path.join(storeDir(env),"skills");
export const PROJECT_SKILL_DIRS=[".layanx/skills",".claude/skills",".agents/skills"];
type Stats=Record<string,{uses:number;success:number;status?:PlaybookStatus;note?:string;approvedHash?:string}>;
export function listPlaybooks(projectId?:string,env:NodeJS.ProcessEnv=process.env):Playbook[]{
  const stats=readJson<Stats>(statsFile(env),{});
  let projectItems:Parsed[]=[];
  if(projectId){try{const dir=projectDir(projectId);
    projectItems=[...mdFiles(path.join(dir,".layanx","playbooks")).map(f=>parse(f,"project")),...PROJECT_SKILL_DIRS.flatMap(d=>skillDirs(path.join(dir,d))).map(d=>parseSkill(d,"project"))].filter(Boolean) as Parsed[];}catch{}}
  const items=[...mdFiles(BUILTIN_PLAYBOOKS).map(f=>parse(f,"builtin")),...mdFiles(learnedDir(env)).map(f=>parse(f,"learned")),...skillDirs(userSkillsDir(env)).map(d=>parseSkill(d,"learned")),...projectItems].filter(Boolean) as Parsed[];
  return items.map(p=>{
    const s=stats[p.id];
    let status=s?.status??p.status;
    let note=s?.note??p.note;
    const unsafe=p.source!=="builtin"&&scanPlaybook(p.scanText??p.title+"\n"+p.body).length>0;
    if(unsafe&&status!=="disabled")status="rejected";
    else if(p.source==="project"&&status!=="disabled"&&status!=="rejected"){
      // Trusted only when this exact content was approved by the owner or written by LayanX's own research.
      status=s?.approvedHash===p.hash?"active":"candidate";
      if(status==="candidate")note=s?.approvedHash?"Changed since it was approved; waiting for the owner again.":"Came with the project files; waiting for the owner's approval.";
    }else if(status==="active"&&p.source!=="builtin"&&s?.approvedHash&&s.approvedHash!==p.hash){status="candidate";note="Changed since it was approved; waiting for the owner again.";}
    const {scanText:_omit,...rest}=p;
    return{...rest,status,uses:s?.uses??0,success:s?.success??0,...(note?{note}:{})};
  });
}
export function matchPlaybooks(q:{goal:string;stack?:string;projectId?:string},k=2,env:NodeJS.ProcessEnv=process.env):Playbook[]{
  const words=new Set(tokens(q.goal));
  return listPlaybooks(q.projectId,env).filter(p=>p.status==="active")
    // a guide for another stack is wrong advice, not weak advice
    .filter(p=>!q.stack||q.stack==="unknown"||!p.stacks.length||p.stacks.includes("any")||p.stacks.includes(q.stack)).map(p=>{
    const tagHits=p.tags.filter(t=>words.has(t)||[...words].some(w=>w.length>4&&(t.includes(w)||w.includes(t)))).length;
    const titleHits=tokens(p.title).filter(t=>words.has(t)).length;
    let score=tagHits*2+titleHits;
    if(q.stack&&p.stacks.length&&p.stacks.includes(q.stack))score+=1.5;
    if(p.source==="project")score+=2;
    if(p.uses>=3)score+=(p.success/p.uses-0.5)*2;
    return{p,score};
  }).filter(x=>x.score>=2).sort((a,b)=>b.score-a.score).slice(0,k).map(x=>x.p);
}
export function recordPlaybookOutcome(ids:string[],success:boolean,env:NodeJS.ProcessEnv=process.env){
  if(!ids.length)return;
  const stats=readJson<Stats>(statsFile(env),{});
  for(const id of ids){
    const s=stats[id]??{uses:0,success:0};s.uses++;if(success)s.success++;
    if(s.uses>=5&&s.success/s.uses<0.4){s.status="disabled";s.note=`Switched off automatically: ${s.success}/${s.uses} successful jobs.`;}
    stats[id]=s;
  }
  writeJson(statsFile(env),stats);
}
export function setPlaybookStatus(id:string,status:PlaybookStatus,env:NodeJS.ProcessEnv=process.env,projectId?:string){
  const p=listPlaybooks(projectId,env).find(x=>x.id===id);
  if(!p)throw new Error("Playbook not found.");
  const problems=status==="active"?scanPlaybook(rawForScan(p)):[];
  if(problems.length)throw new Error("This playbook failed the safety scan and cannot be enabled: "+problems.join("; "));
  const stats=readJson<Stats>(statsFile(env),{});
  stats[id]={...(stats[id]??{uses:0,success:0}),status,note:status==="active"?"Approved by the owner.":stats[id]?.note??"",...(status==="active"?{approvedHash:p.hash}:{})};
  writeJson(statsFile(env),stats);
}
/** Text the scanner checks: for a skill, the whole folder; for a playbook, title + body. */
function rawForScan(p:Playbook):string{
  if(p.format==="skill"){const again=parseSkill(path.dirname(p.file),p.source);return again?.scanText??p.body;}
  return p.title+"\n"+p.body;
}
/** A playbook LayanX's own research wrote during a job: trusted in that project for this exact content. */
export function trustProjectPlaybook(projectId:string,id:string,env:NodeJS.ProcessEnv=process.env):boolean{
  const p=listPlaybooks(projectId,env).find(x=>x.id===id&&x.source==="project");
  if(!p||p.status==="rejected"||scanPlaybook(rawForScan(p)).length)return false;
  const stats=readJson<Stats>(statsFile(env),{});
  stats[id]={...(stats[id]??{uses:0,success:0}),status:"active",approvedHash:p.hash,note:"Written by LayanX research in project "+projectId+"."};
  writeJson(statsFile(env),stats);return true;
}

/** Export an approved playbook as a portable skill folder (SKILL.md, agentskills.io format). */
export function exportSkill(id:string,targetDir:string,env:NodeJS.ProcessEnv=process.env,projectId?:string):string{
  const p=listPlaybooks(projectId,env).find(x=>x.id===id);
  if(!p)throw new Error("Playbook not found.");
  if(p.status!=="active")throw new Error("Only approved playbooks can be exported.");
  const slug=p.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60)||p.id.replace(/[^a-z0-9]+/gi,"-").toLowerCase();
  const dir=path.join(targetDir,slug);fs.mkdirSync(dir,{recursive:true});
  const description=(p.title+(p.tags.length?". Use for: "+p.tags.slice(0,10).join(", "):"")).replace(/[\r\n]+/g," ").slice(0,900);
  fs.writeFileSync(path.join(dir,"SKILL.md"),`---\nname: ${slug}\ndescription: ${description}\n---\n\n# ${p.title}\n\n${p.body}\n`);
  return dir;
}

/** Text that would try to steer the agent or run something harmful never becomes guidance. */
export function scanPlaybook(text:string):string[]{
  const rules:Array<[RegExp,string]>=[
    [/\b(ignore|disregard|forget)\b[^.\n]{0,30}\b(previous|prior|above|all|earlier)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?)\b/i,"prompt injection"],
    [/\b(system prompt|you are now|act as (an?|the) (admin|root|developer mode)|jailbreak|DAN mode)\b/i,"prompt injection"],
    [/\bcurl\b[^|\n]*\|\s*(ba|z)?sh\b|\bwget\b[^|\n]*\|\s*(ba)?sh\b|\biwr\b[^|\n]*\|\s*iex\b|Invoke-Expression|powershell(\.exe)?\s+-(e|enc|encodedcommand)\b/i,"downloads and runs a script"],
    [/\brm\s+-rf\s+(\/|~|\$HOME|\*)|\bformat\s+[a-z]:|\bdel\s+\/[sq]\b|\bRemove-Item\b[^\n]*-Recurse[^\n]*(C:\\|\$env:)|\bmkfs\b|\bdd\s+if=/i,"destructive command"],
    [/\b(send|post|upload|exfiltrat\w*|copy|paste|share)\b[^\n]{0,60}?(?:\b(?:api[_ -]?keys?|tokens?|secrets?|passwords?|credentials|private key|cookies?)\b|\.env\b)[^\n]{0,40}?\b(to|into|on)\b\s+(https?:|[\w-]+\.[\w.-]{2,})/i,"sends secrets somewhere"],
    [/\b(disable|turn off|bypass)\b[^.\n]{0,30}\b(antivirus|defender|firewall|security checks?|approvals?|sandbox|layanx security)\b/i,"disables protection"],
    [/--no-verify\b|git\s+push\s+(-f|--force)\b|chmod\s+777\b/i,"unsafe flag"],
    [/[A-Za-z0-9+/]{240,}={0,2}/,"long encoded blob"],
    // Tricks seen in the malicious-skill campaigns of 2026 (fake prerequisites that fetch an infostealer).
    [/\b(pastebin\.com|paste\.ee|rentry\.(co|org)|hastebin|ghostbin|pastes\.io|privatebin|transfer\.sh|0x0\.st|termbin\.com|dpaste)\b/i,"downloads from a paste site"],
    [/https?:\/\/\d{1,3}(\.\d{1,3}){3}(:\d+)?\//i,"talks to a raw IP address"],
    [/\bcertutil(\.exe)?\s+-(urlcache|decode)|\bbitsadmin\s+\/transfer|\bmshta(\.exe)?\s+https?:|\bregsvr32\b[^\n]*\/i:https?:|\brundll32\b[^\n]*javascript:/i,"downloads with a Windows system tool"],
    [/\bbase64\s+(-d|--decode)\b[^\n|]*\|\s*(ba|z)?sh\b|FromBase64String[^\n]*\|\s*(iex|Invoke-Expression)/i,"decodes and runs hidden code"],
    [/\b(Add|Set)-MpPreference\b[^\n]*(Exclusion|DisableRealtimeMonitoring)|\bxattr\s+-[a-z]*d[a-z]*\s+com\.apple\.quarantine/i,"disables protection"],
    [/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/,"hidden or direction-changing characters"],
    [/\b(download|curl|wget|iwr|Invoke-WebRequest)\b[^\n]{0,160}\.(exe|msi|scr|dmg|pkg|apk)\b/i,"downloads a program"],
    [/\b(password|passcode)\b[^\n]{0,40}\b(zip|rar|7z|archive)\b|\.(zip|rar|7z)\b[^\n]{0,40}\bpassword\b/i,"password-protected archive"]
  ];
  return[...new Set(rules.filter(([rx])=>rx.test(text)).map(([,why])=>why))];
}

export function savePlaybookCandidate(p:{title:string;tags:string[];stacks:string[];body:string;note?:string},env:NodeJS.ProcessEnv=process.env):Playbook{
  const problems=scanPlaybook(p.title+"\n"+p.body);
  const slug=(p.title.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,40)||"playbook")+"-"+createHash("sha256").update(p.body).digest("hex").slice(0,6);
  const dir=learnedDir(env);fs.mkdirSync(dir,{recursive:true});
  const status:PlaybookStatus=problems.length?"rejected":"candidate";
  const clean=(s:string)=>s.replace(/[\r\n]+/g," ").slice(0,200);
  fs.writeFileSync(path.join(dir,slug+".md"),`---\ntitle: ${clean(p.title)}\ntags: [${p.tags.map(t=>clean(t).toLowerCase()).slice(0,12).join(", ")}]\nstacks: [${p.stacks.map(s=>clean(s).toLowerCase()).slice(0,5).join(", ")}]\nstatus: ${status}\nnote: ${clean(problems.length?"Rejected by the safety scan: "+problems.join(", "):p.note??"Learned from a successful job; waiting for the owner's approval.")}\n---\n${p.body.slice(0,8000)}\n`);
  return listPlaybooks(undefined,env).find(x=>x.id==="learned:"+slug)!;
}

/** Compact guidance for prompts. */
export function guidanceText(playbooks:Playbook[],lessons:Lesson[],max=2400):string{
  const parts:string[]=[];
  for(const p of playbooks)parts.push(`PLAYBOOK "${p.title}" (${p.source}):\n${p.body.slice(0,Math.floor(max*0.7/Math.max(playbooks.length,1)))}`);
  if(lessons.length)parts.push("LESSONS FROM PAST WORK:\n"+lessons.map(l=>`- ${l.text}`).join("\n"));
  const t=parts.join("\n\n");return t.length>max?t.slice(0,max)+"…":t;
}
