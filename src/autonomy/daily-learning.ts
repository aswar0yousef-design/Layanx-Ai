import fs from "node:fs";
import path from "node:path";
import {randomUUID,createHash} from "node:crypto";
import type {BenchmarkScore} from "./improvement-cycle.js";
import {activateMeasuredPlaybook,matchPlaybooks,savePlaybookCandidate,setPlaybookStatus,tokens} from "./learning.js";
import {pickTopics,scoutSkills,type ScoutClient,type SkillPassedOver} from "./skill-scout.js";
import {researchTask,type ResearchDeps} from "./task-research.js";

/**
 * One day of learning. It picks what to study, uses a published skill when one fits and otherwise writes its own guide from
 * what the web says, then runs the benchmark with and without that guidance. Harm means it is dropped. The benchmark is
 * about building software, so for other fields it only proves the guide does no damage; after that, real use decides,
 * and a guide that keeps failing is switched off by the usage counters.
 */
export interface LearnedRecord{id:string;at:string;topic:string;title:string;source:string;status:"kept"|"dropped"|"not_measured"|"covered"|"nothing_found";why:string;sha256?:string;playbook?:string;before?:BenchmarkScore;after?:BenchmarkScore}
export interface LearningLedger{records:LearnedRecord[];heldForOwner:Array<SkillPassedOver&{topic:string;at:string}>}
export interface DailyInput{ledgerFile:string;workDir:string;failures:string[];recentGoals:string[];client:ScoutClient;research:ResearchDeps;benchmark:(guidanceFile?:string)=>Promise<BenchmarkScore>;env?:NodeJS.ProcessEnv;now?:Date;log?:(line:string)=>void;maxTopics?:number}

export const readLearningLedger=(file:string):LearningLedger=>{try{const parsed=JSON.parse(fs.readFileSync(file,"utf8"));return{records:parsed.records??[],heldForOwner:parsed.heldForOwner??[]};}catch{return{records:[],heldForOwner:[]};}};
const save=(file:string,ledger:LearningLedger)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=file+".tmp";fs.writeFileSync(tmp,JSON.stringify({records:ledger.records.slice(-400),heldForOwner:ledger.heldForOwner.slice(-200)},null,1),{mode:0o600});fs.renameSync(tmp,file);};
export const noHarm=(before:BenchmarkScore,after:BenchmarkScore)=>after.runs===before.runs&&after.passed>=before.passed&&after.falseSuccess<=before.falseSuccess;

export async function runDailyLearning(input:DailyInput):Promise<LearnedRecord[]>{
  const env=input.env??process.env,now=input.now??new Date(),log=input.log??(()=>undefined),ledger=readLearningLedger(input.ledgerFile);
  const seen=new Set(ledger.records.map(record=>record.sha256).filter(Boolean) as string[]);
  const topics=pickTopics(input.failures,input.recentGoals,Math.floor(now.getTime()/86_400_000),input.maxTopics??3);
  const fresh:LearnedRecord[]=[];
  const pending:Array<{record:LearnedRecord;body:string}>=[];
  const add=(record:Omit<LearnedRecord,"id"|"at">)=>{const full={id:randomUUID(),at:now.toISOString(),...record};fresh.push(full);ledger.records.push(full);save(input.ledgerFile,ledger);return full;};
  for(const topic of topics){
    log("studying: "+topic);
    // Covered means a guide about this very subject, not one that shares a word with it ("whatsapp messaging" is not a Flutter screen).
    const words=topic.toLowerCase().split(/[^a-z0-9]+/).filter(word=>word.length>2);
    const known=matchPlaybooks({goal:topic},3,env).find(guide=>{const about=[guide.title,...guide.tags].join(" ").toLowerCase();return words.every(word=>about.includes(word));});
    if(known){add({topic,title:known.title,source:known.source,status:"covered",why:"An active guide already covers this."});continue;}
    const scouted=await scoutSkills(topic,input.client,now,seen);
    ledger.heldForOwner.push(...[...scouted.held].map(item=>({...item,topic,at:now.toISOString()})));
    const best=scouted.candidates[0];
    if(best){
      const note=`From ${best.repo} at ${best.commit}, ${best.path}, licence ${best.license}. On trial.`;
      const playbook=savePlaybookCandidate({title:best.name,tags:tokens(topic+" "+best.name+" "+best.description).slice(0,12),stacks:[],body:(best.description?best.description+"\n\n":"")+best.body,note},env);
      if(!playbook||playbook.status==="rejected"){add({topic,title:best.name,source:best.repo,status:"dropped",why:"The safety scan refused it.",sha256:best.sha256});continue;}
      seen.add(best.sha256);
      pending.push({record:add({topic,title:best.name,source:`${best.repo}@${best.commit.slice(0,10)}`,status:"not_measured",why:"Waiting for the benchmark.",sha256:best.sha256,playbook:playbook.id}),body:playbook.body});
      continue;
    }
    // Nothing published fits, so it studies the subject and writes the guide itself.
    const brief=await researchTask({goal:"Learn the professional best practice for: "+topic},{...input.research,env:{...env,LAYANX_BENCHMARK_GUIDANCE_FILE:""}});
    if(brief.status!=="ready"){add({topic,title:topic,source:"web",status:"nothing_found",why:scouted.problem??brief.problem??"No usable skill or source was found."});continue;}
    const sha256=createHash("sha256").update(brief.text).digest("hex");
    const playbook=savePlaybookCandidate({title:"Best practice: "+topic,tags:tokens(topic).slice(0,12),stacks:[],body:brief.text+"\n\nSources:\n"+brief.sources.slice(0,6).map(source=>"- "+source.url).join("\n"),note:"Written from web research. On trial."},env);
    if(!playbook||playbook.status==="rejected"){add({topic,title:topic,source:"web",status:"dropped",why:"The safety scan refused it.",sha256});continue;}
    pending.push({record:add({topic,title:playbook.title,source:"web research",status:"not_measured",why:"Waiting for the benchmark.",sha256,playbook:playbook.id}),body:playbook.body});
  }
  if(!pending.length){save(input.ledgerFile,ledger);return fresh;}
  let before:BenchmarkScore;
  try{before=await input.benchmark();}
  catch(error){for(const{record}of pending)record.why="The benchmark could not run: "+(error as Error).message.slice(0,200);save(input.ledgerFile,ledger);return fresh;}
  fs.mkdirSync(input.workDir,{recursive:true});
  for(const{record,body}of pending){
    const file=path.join(input.workDir,record.id+".md");
    fs.writeFileSync(file,body.slice(0,2000));
    try{
      const after=await input.benchmark(file);
      Object.assign(record,{before,after});
      if(noHarm(before,after)){record.status="kept";record.why=`The benchmark did not get worse (${before.passed} of ${before.runs} before, ${after.passed} after).`;activateMeasuredPlaybook(record.playbook!,record.why,env);}
      else{record.status="dropped";record.why=`It made results worse (${before.passed} of ${before.runs} before, ${after.passed} after, ${after.falseSuccess} false successes).`;setPlaybookStatus(record.playbook!,"rejected",env);}
    }catch(error){record.why="The benchmark could not run: "+(error as Error).message.slice(0,200);}
    finally{fs.rmSync(file,{force:true});}
    save(input.ledgerFile,ledger);log(`${record.title}: ${record.status}. ${record.why}`);
  }
  return fresh;
}
