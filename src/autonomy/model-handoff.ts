import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Moves unfinished work between models. Every rule here looks at observed facts (what the checks said, which files
 * really changed), never at what a model says about itself, and HANDOFF.md is written by the system for the same reason.
 */
/** proven: models with a measured record of passing the acceptance runs. A ladder must never give them fewer tries than they had without one. */
export type ModelLadders={coding:string[];planning:string[];proven?:string[]};
export type AttemptOutcome="passed"|"unresponsive"|"unusable-output"|"claimed-done"|"failed";
export interface ModelAttempt{at:string;session:number;milestone:number;model:string;outcome:AttemptOutcome;summary:string;signature:string;changedFiles:boolean}
export interface HandoffRecord{at:string;milestone:number;from:string;to?:string;reason:string;file:string}
export interface ModelRunState{ladders:ModelLadders;unresponsive:string[];attempts:ModelAttempt[];handoffs:HandoffRecord[];baseFiles:Record<string,string>;latest?:string}
export type FailureDecision={action:"retry"}|{action:"switch";rung:number;model:string;reason:string}|{action:"exhausted";reason:string};

export const ATTEMPTS_PER_MODEL=2;
export const FULL_ATTEMPTS=4;
const UNRESPONSIVE=/\babort|timed? ?out|fetch failed|All candidate model providers failed|provider unavailable/i;
const UNUSABLE=/invalid JSON|no edits|empty (?:response|answer)|invalid tool/i;

/** Two reports of the same failure must compare equal even if temp paths, ports or line numbers differ. */
export function failureSignature(text:string):string{
  // The whole text counts: node echoes the source line first, so a prefix of a one-line file hides the actual error.
  const normalized=text.toLowerCase().replace(/[a-z]:[\\/][^\s"'`]+/g,"<path>").replace(/\/(?:tmp|users|home)\/[^\s"'`]+/g,"<path>")
    .replace(/\b[0-9a-f]{8,}\b/g,"<id>").replace(/\d+/g,"#").replace(/\s+/g," ").trim();
  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0,16);
}
export function classifyFailure(input:{agentStopped?:string;failedChecks:string[];changedFiles:boolean}):AttemptOutcome{
  const stopped=input.agentStopped??"";
  if(UNRESPONSIVE.test(stopped))return"unresponsive";
  if(UNUSABLE.test(stopped))return"unusable-output";
  // The model said it finished, yet the checks disagree and nothing on disk changed.
  if(input.agentStopped===undefined&&input.failedChecks.length>0&&!input.changedFiles)return"claimed-done";
  return"failed";
}
const REASONS:Record<AttemptOutcome,string>={
  passed:"passed",unresponsive:"the model did not answer in time","unusable-output":"the model returned unusable output",
  "claimed-done":"the model reported completion but the checks failed and no file changed",failed:"the attempt failed"
};
export function firstUsableRung(ladder:string[],unresponsive:string[]):number{
  const rung=ladder.findIndex(model=>!unresponsive.includes(model));
  return rung<0?0:rung;
}
/** Retry the same model only while it is still making new mistakes within its quota. */
export function decideAfterFailure(input:{ladder:string[];rung:number;unresponsive:string[];earlierOnRung:ModelAttempt[];attempt:ModelAttempt;proven?:string[]}):FailureDecision{
  const{attempt,earlierOnRung}=input;
  const repeated=earlierOnRung.some(previous=>previous.signature===attempt.signature);
  // Leaving a proven model early, or stopping at the last one early, loses work that more tries would have finished.
  const noneAfter=!input.ladder.slice(input.rung+1).some(model=>!input.unresponsive.includes(model));
  const fullBudget=noneAfter||Boolean(input.proven?.includes(attempt.model));
  // One malformed reply from such a model is noise; the gates still refuse a false "done", and a repeat still ends it.
  const immediate=attempt.outcome==="unresponsive"||(!fullBudget&&(attempt.outcome==="unusable-output"||attempt.outcome==="claimed-done"));
  const quota=fullBudget?FULL_ATTEMPTS:ATTEMPTS_PER_MODEL;
  const spent=earlierOnRung.length+1>=quota;
  if(!immediate&&!repeated&&!spent)return{action:"retry"};
  const reason=immediate?REASONS[attempt.outcome]:repeated?"the same failure happened again":`the model used its ${quota} attempts`;
  for(let rung=input.rung+1;rung<input.ladder.length;rung++){
    const model=input.ladder[rung]!;
    if(!input.unresponsive.includes(model))return{action:"switch",rung,model,reason};
  }
  return{action:"exhausted",reason};
}

const SKIPPED=new Set([".git",".layanx","node_modules","dist","build",".next","coverage",".expo"]);
/** A content map of the project, so "what changed" comes from the disk and not from anyone's claim. */
export function projectFingerprint(dir:string,limit=3000):Record<string,string>{
  const files:Record<string,string>={};let count=0;
  const walk=(folder:string)=>{
    let entries:fs.Dirent[];
    try{entries=fs.readdirSync(folder,{withFileTypes:true});}catch{return;}
    for(const entry of entries){
      if(count>=limit)return;
      const full=path.join(folder,entry.name);
      if(entry.isDirectory()){if(!SKIPPED.has(entry.name))walk(full);continue;}
      if(!entry.isFile())continue;
      count++;
      const relative=path.relative(dir,full).replace(/\\/g,"/");
      try{
        const size=fs.statSync(full).size;
        files[relative]=size>2_000_000?"size:"+size:crypto.createHash("sha1").update(fs.readFileSync(full)).digest("hex");
      }catch{files[relative]="unreadable";}
    }
  };
  walk(dir);
  return files;
}
export function diffFingerprints(before:Record<string,string>,after:Record<string,string>){
  const added=Object.keys(after).filter(file=>before[file]===undefined).sort();
  const modified=Object.keys(after).filter(file=>before[file]!==undefined&&before[file]!==after[file]).sort();
  const deleted=Object.keys(before).filter(file=>after[file]===undefined).sort();
  return{added,modified,deleted,any:added.length+modified.length+deleted.length>0};
}

export interface HandoffInput{
  goal:string;acceptance:string[];status:"transfer"|"blocked";from:string;to?:string;reason:string;
  milestones:Array<{title:string;goal:string;status:string}>;current:number;
  evidence:Array<{milestone:string;checks:string}>;
  changes:ReturnType<typeof diffFingerprints>;attempts:ModelAttempt[];lastFailure:string;
}
const list=(items:string[],empty:string)=>items.length?items.map(item=>"- "+item).join("\n"):"- "+empty;
export function renderHandoff(input:HandoffInput):string{
  const current=input.milestones[input.current];
  const fileLines=[...input.changes.added.map(f=>f+" (new)"),...input.changes.modified.map(f=>f+" (modified)"),...input.changes.deleted.map(f=>f+" (deleted)")];
  const tried=input.attempts.filter(a=>a.outcome!=="passed");
  return[
    "# LayanX handoff",
    "Written by LayanX from observed checks and files, not by a model.",
    input.status==="blocked"
      ?`**STATUS: BLOCKED / متوقف.** Every available model was tried. Last model: ${input.from}. Reason: ${input.reason}. The work is not complete.`
      :`**STATUS: TRANSFER / تحويل.** From ${input.from} to ${input.to}. Reason: ${input.reason}. The work is not complete.`,
    "## Goal / الهدف\n"+input.goal,
    "## Do not repeat / لا تكرر\n"+list(tried.map(a=>`${a.model}: ${a.summary.replace(/\s+/g," ").slice(0,220)}`),"nothing has failed yet"),
    "## Last failure, exact / آخر فشل بنصه\n```\n"+input.lastFailure.slice(0,1500)+"\n```",
    "## Next action / الخطوة التالية\n"+(input.status==="blocked"
      ?"A stronger model, a person, or more information is needed for the step below."
      :"Continue from the files as they are now. Do not redo finished steps and do not start over.")+(current?`\nCurrent step: ${current.title}: ${current.goal.slice(0,400)}`:""),
    "## Done and verified / ما تم والتحقق منه\n"+list(input.evidence.map(e=>`${e.milestone} (${e.checks})`),"no step has been verified yet"),
    "## Files changed so far / الملفات التي تغيرت فعلاً\n"+list(fileLines.slice(0,40),"no project file has changed yet"),
    "## Remaining / المتبقي\n"+list(input.milestones.slice(input.current).map(m=>m.title),"only final verification"),
    "## How it is judged / معيار الاكتمال\nOnly passing checks count; saying it is done does not.\n"+list(input.acceptance.slice(0,8),"the goal above")
  ].join("\n\n")+"\n";
}
/** HANDOFF.md is always the current state; the numbered copies keep the chain for review. */
export function writeHandoff(dir:string,jobId:string,sequence:number,text:string):string{
  const root=path.join(dir,".layanx"),archive=path.join(root,"handoffs");
  fs.mkdirSync(archive,{recursive:true});
  fs.writeFileSync(path.join(root,"HANDOFF.md"),text);
  const name=`${jobId.slice(0,8)}-${String(sequence).padStart(2,"0")}.md`;
  fs.writeFileSync(path.join(archive,name),text);
  return".layanx/handoffs/"+name;
}
