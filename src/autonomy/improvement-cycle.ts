import fs from "node:fs";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";

/**
 * How LayanX gets better without getting worse. A change is tried on the same fixed benchmark as the current behaviour and
 * stays only when it measurably helps, regresses no case and adds no false success. A win is run a second time before it
 * counts, because small samples of a local model are noisy. What can be changed is an explicit list: trust, approvals,
 * sandboxing, secrets and live accounts are not on it, and no score can put them there.
 */
export interface CaseScore{passed:number;runs:number}
export interface BenchmarkScore{runs:number;passed:number;falseSuccess:number;minutes:number;byCase:Record<string,CaseScore>;report?:string}
export type Benchmark=(env:Record<string,string>)=>Promise<BenchmarkScore>;
export interface Proposal{title:string;reason:string;settings:Record<string,string>}
export type ImprovementStatus="kept"|"rejected"|"refused"|"rolled_back";
export interface LedgerEntry{id:string;at:string;title:string;reason:string;settings:Record<string,string>;status:ImprovementStatus;why:string;codeVersion:string;before?:BenchmarkScore;after?:BenchmarkScore[]}
export interface Ledger{entries:LedgerEntry[];baselines:Record<string,BenchmarkScore>}

/** Only what tunes how well the work is done. Anything that decides what LayanX is allowed to do is absent on purpose. */
const TUNABLE:Record<string,RegExp>={
  LAYANX_OLLAMA_THINK:/^(?:on|off)$/,
  LAYANX_OLLAMA_CONTEXT:/^\d{4,6}$/,
  LAYANX_OLLAMA_NUM_PREDICT:/^\d{3,5}$/,
  OLLAMA_TIMEOUT_MS:/^\d{5,6}$/,
  LAYANX_REVIEW_MODEL:/^[\w.:/-]+$/
};
const isCloudModel=(value:string)=>/cloud|^https?:|openai|anthropic|gemini/i.test(value);
export function settingRefusal(settings:Record<string,string>):string|undefined{
  const keys=Object.keys(settings);
  if(!keys.length)return"The proposal changes nothing.";
  for(const key of keys){
    if(!Object.hasOwn(TUNABLE,key))return`${key} is not something LayanX may change on its own.`;
    if(!TUNABLE[key]!.test(settings[key]!))return`${key} has a value outside what is allowed.`;
    if(key==="LAYANX_REVIEW_MODEL"&&isCloudModel(settings[key]!))return"A cloud model needs the owner's approval.";
  }
  return undefined;
}

/** Keep only a real gain: every case at least as good, no new false success, and more passes or the same passes clearly faster. */
export function judge(before:BenchmarkScore,after:BenchmarkScore,minGain=1):{keep:boolean;why:string}{
  if(before.runs!==after.runs||!before.runs)return{keep:false,why:`The runs are not comparable (${before.runs} and ${after.runs}).`};
  if(after.falseSuccess>before.falseSuccess)return{keep:false,why:`False successes rose from ${before.falseSuccess} to ${after.falseSuccess}.`};
  const worse=Object.keys(before.byCase).filter(id=>(after.byCase[id]?.passed??0)<before.byCase[id]!.passed);
  if(worse.length)return{keep:false,why:"Worse on: "+worse.join(", ")};
  if(after.passed-before.passed>=minGain)return{keep:true,why:`Passes went from ${before.passed} to ${after.passed} of ${after.runs}.`};
  if(after.falseSuccess<before.falseSuccess)return{keep:true,why:`False successes fell from ${before.falseSuccess} to ${after.falseSuccess}.`};
  if(after.passed===before.passed&&before.minutes>0&&after.minutes<=before.minutes*0.8)return{keep:true,why:`Same result in ${Math.round(after.minutes)} minutes instead of ${Math.round(before.minutes)}.`};
  return{keep:false,why:`No measured gain: ${before.passed} before and ${after.passed} after, of ${after.runs}.`};
}

const emptyLedger=():Ledger=>({entries:[],baselines:{}});
export const readLedger=(file:string):Ledger=>{try{return{...emptyLedger(),...JSON.parse(fs.readFileSync(file,"utf8"))};}catch{return emptyLedger();}};
function writeLedger(file:string,ledger:Ledger){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+"."+randomUUID()+".tmp";
  fs.writeFileSync(temporary,JSON.stringify(ledger,null,2),{mode:0o600});
  fs.renameSync(temporary,file);
}
/** Settings that earned their place, for the next start. A value the owner set themselves always wins. */
export function applyKeptSettings(file:string,env:NodeJS.ProcessEnv=process.env):string[]{
  const applied:string[]=[];
  for(const entry of readLedger(file).entries.filter(item=>item.status==="kept")){
    if(settingRefusal(entry.settings))continue;
    for(const[key,value]of Object.entries(entry.settings))if(env[key]===undefined){env[key]=value;applied.push(key);}
  }
  return applied;
}
const fingerprint=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0,16);
const scoreOf=(scores:BenchmarkScore[])=>scores.reduce((low,score)=>score.passed<low.passed?score:low);

export interface CycleInput{ledgerFile:string;benchmark:Benchmark;benchmarkId:string;codeVersion:string;minGain?:number;currentSettings?:Record<string,string>}
/** Tries one proposal from start to finish and writes down what happened, whatever happened. */
export async function tryProposal(input:CycleInput,proposal:Proposal):Promise<LedgerEntry>{
  const ledger=readLedger(input.ledgerFile);
  const base={id:randomUUID(),at:new Date().toISOString(),title:proposal.title,reason:proposal.reason,settings:proposal.settings,codeVersion:input.codeVersion};
  const finish=(entry:LedgerEntry)=>{const latest=readLedger(input.ledgerFile);latest.entries.push(entry);Object.assign(latest.baselines,ledger.baselines);writeLedger(input.ledgerFile,latest);return entry;};
  const refused=settingRefusal(proposal.settings);
  if(refused)return finish({...base,status:"refused",why:refused});
  const asked=fingerprint(proposal.settings);
  const tried=ledger.entries.find(entry=>entry.codeVersion===input.codeVersion&&entry.status!=="refused"&&fingerprint(entry.settings)===asked);
  if(tried)return finish({...base,status:"refused",why:`Already tried on this code: ${tried.status}. ${tried.why}`});
  const key=fingerprint([input.benchmarkId,input.codeVersion,input.currentSettings??{}]);
  const before=ledger.baselines[key]??await input.benchmark(input.currentSettings??{});
  ledger.baselines[key]=before;
  const overlay={...input.currentSettings,...proposal.settings};
  const first=await input.benchmark(overlay);
  let verdict=judge(before,first,input.minGain);
  const after=[first];
  if(verdict.keep){
    const second=await input.benchmark(overlay);
    after.push(second);
    const confirmed=judge(before,scoreOf(after),input.minGain);
    verdict=confirmed.keep?{keep:true,why:verdict.why+" Confirmed by a second run."}:{keep:false,why:"The gain did not repeat. "+confirmed.why};
  }
  return finish({...base,status:verdict.keep?"kept":"rejected",why:verdict.why,before,after});
}
/** Undoes a kept change, for example when a later measurement shows it stopped helping. */
export function rollBack(file:string,id:string,why:string):LedgerEntry|undefined{
  const ledger=readLedger(file),entry=ledger.entries.find(item=>item.id===id&&item.status==="kept");
  if(!entry)return undefined;
  entry.status="rolled_back";entry.why=why;
  writeLedger(file,ledger);
  return entry;
}

// ---------------------------------------------------------------- learning from what already went wrong
export interface FailurePattern{id:string;label:string;count:number;projects:number;sample:string}
const PATTERNS:Array<{id:string;label:string;test:RegExp}>=[
  {id:"timeout",label:"The model did not answer in time",test:/operation was aborted|did not answer in time|timed out/i},
  {id:"bad-json",label:"The model's reply was not usable JSON",test:/invalid JSON|No JSON found|incomplete JSON|Unusable output/i},
  {id:"no-edits",label:"The model proposed no change",test:/returned no edits/i},
  {id:"find-not-unique",label:"A patch did not match the file exactly",test:/find must occur exactly once|not found in/i},
  {id:"too-many-edits",label:"A patch tried to change too much",test:/More than \d+ edits/i},
  {id:"syntax",label:"The written code does not parse",test:/SyntaxError/},
  {id:"scope",label:"The code uses something that does not exist there",test:/is not defined/},
  {id:"tests-refused",label:"The written checks were not confirmed",test:/Tests refused|Steps refused/},
  {id:"patch-broke",label:"A patch broke something that worked",test:/broke tests that passed|Patch undone/}
];
export function classifyFailureText(text:string):string|undefined{return PATTERNS.find(pattern=>pattern.test.test(text))?.id;}
/** Counts causes across finished jobs, most frequent first. Reads job records only. */
export function mineFailures(jobFiles:string[]):FailurePattern[]{
  const seen=new Map<string,{count:number;projects:Set<string>;sample:string}>();
  for(const file of jobFiles){
    let raw:unknown;
    try{raw=JSON.parse(fs.readFileSync(file,"utf8"));}catch{continue;}
    const jobs:any[]=Array.isArray(raw)?raw:Array.isArray((raw as any)?.jobs)?(raw as any).jobs:Object.values(raw as object);
    for(const job of jobs){
      const texts=[...(job?.log??[]).map((line:any)=>String(line?.msg??"")),...(job?.milestones??[]).map((m:any)=>String(m?.notes??""))];
      // A lesson quoted back in the log is not a failure of this job.
      for(const text of texts.filter(line=>!/^Learned:/.test(line))){
        const id=classifyFailureText(text);
        if(!id)continue;
        const entry=seen.get(id)??{count:0,projects:new Set<string>(),sample:text.slice(0,240)};
        entry.count++;entry.projects.add(String(job?.projectId??file));
        seen.set(id,entry);
      }
    }
  }
  return[...seen].map(([id,entry])=>({id,label:PATTERNS.find(p=>p.id===id)!.label,count:entry.count,projects:entry.projects.size,sample:entry.sample})).sort((a,b)=>b.projects-a.projects||b.count-a.count);
}
const EXPERIMENTS:Record<string,Proposal[]>={
  timeout:[{title:"Give the local model longer to answer",reason:"Answers are being cut off by the time limit.",settings:{OLLAMA_TIMEOUT_MS:"300000"}}],
  "bad-json":[{title:"Let the model reason more before answering",reason:"Replies are arriving unusable.",settings:{LAYANX_OLLAMA_THINK:"on"}},{title:"Give the model more context",reason:"Long prompts may be cut before the model reads the format.",settings:{LAYANX_OLLAMA_CONTEXT:"16384"}}],
  "no-edits":[{title:"Let the model reason more before patching",reason:"The model finds no change to propose.",settings:{LAYANX_OLLAMA_THINK:"on"}}],
  "find-not-unique":[{title:"Give the model more context",reason:"Patches do not match the file it was shown.",settings:{LAYANX_OLLAMA_CONTEXT:"16384"}}],
  syntax:[{title:"Let the model reason more before writing code",reason:"Written code does not parse.",settings:{LAYANX_OLLAMA_THINK:"on"}}]
};
/** The experiments worth running next, led by the most common failure, skipping what was already tried on this code. */
export function proposeExperiments(patterns:FailurePattern[],ledger:Ledger,codeVersion:string,limit=3):Proposal[]{
  const tried=new Set(ledger.entries.filter(entry=>entry.codeVersion===codeVersion).map(entry=>fingerprint(entry.settings)));
  const chosen:Proposal[]=[];
  for(const pattern of patterns)for(const proposal of EXPERIMENTS[pattern.id]??[]){
    const id=fingerprint(proposal.settings);
    if(tried.has(id)||chosen.length>=limit)continue;
    tried.add(id);chosen.push({...proposal,reason:`${proposal.reason} Seen in ${pattern.projects} project(s).`});
  }
  return chosen;
}
