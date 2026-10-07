import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {detectProject,type ProjectInfo} from "./project-runner.js";
import {projectDir} from "./project-dir.js";
import {trustLevel} from "./trust.js";
import {knowledgeSummary,recordIssue,refreshKnowledge,updateHealth} from "./knowledge.js";
import {buildRepoMap} from "./repo-map.js";
import {errorSignature,findLessons,guidanceText,listLessons,listPlaybooks,markLessons,matchPlaybooks,recordLesson,recordPlaybookOutcome,savePlaybookCandidate,trustProjectPlaybook} from "./learning.js";

/**
 * Supervisor: finishes a goal without the owner watching.
 *
 *  1. spec        goal -> acceptance criteria + milestones (+ which checks prove it)
 *  2. baseline    run the project's checks BEFORE changing anything
 *  3. milestones  each one goes to the right specialised agent (coder, tester, researcher, operator, business)
 *  4. gates       after each milestone: tests/build/typecheck/lint must pass AND nothing that passed before may fail
 *  5. repair      failure output goes back to the agent; after 2 local failures a coding agent
 *                 (Aider locally, or Claude Code/Codex if cloud is allowed) and then a cloud model take over
 *  6. visual      for UI work: dev server + browser test on desktop and mobile + a vision model compares
 *                 the screenshot with the acceptance criteria
 *  7. checkpoint  git commit after every passed milestone (if the project trust allows it)
 *  8. notes       .layanx/PROJECT.md and .layanx/CHANGELOG.md so later work builds on, not over, this work
 *
 * Every action still goes through the normal runtime: permissions, approvals (or the project's trust
 * level), audit. The supervisor waits for an approval instead of skipping it, and stops on budget.
 */
export type JobStatus="planning"|"running"|"waiting_approval"|"verifying"|"completed"|"failed"|"cancelled"|"budget_exhausted";
export type MilestoneKind="code"|"test"|"research"|"desktop"|"business"|"general";
export interface Milestone{title:string;goal:string;kind:MilestoneKind;agent:string;status:"pending"|"running"|"done"|"failed";attempts:number;missions:string[];notes?:string}
export interface Checks{install:boolean;test:boolean;build:boolean;typecheck:boolean;lint:boolean;browser:{path:string}|null;security?:boolean}
export interface CheckResult{name:string;ok:boolean;skipped?:boolean;summary:string}
export interface JobLog{at:string;msg:string;level?:"info"|"warn"|"error"}
export interface SupervisorJob{
  id:string;projectId:string;goal:string;status:JobStatus;createdAt:string;updatedAt:string;deadline:string;trust:string;
  acceptance:string[];checks:Checks|null;milestones:Milestone[];current:number;rounds:number;maxRounds:number;
  baseline?:CheckResult[];lastChecks?:CheckResult[];visual?:{url:string;problems:string[];judgement?:string;screens:string[]};
  waiting?:{approvalId:string;missionId:string;index:number;kind:"agent"|"tool";agentId?:string;tool?:string;payload?:Record<string,unknown>;milestone:number};
  cloudUsed:boolean;externalUsed:string[];checkpoints:string[];log:JobLog[];result?:string;finalRepairs:number;
  branch?:string;security?:{score:number;blocked:boolean;counts:Record<string,number>};
  playbooks?:string[];lessons?:string[];learned?:string[];discovered?:string[];
}
export interface AgentRun{completed?:boolean;paused?:boolean;missionId?:string;nextToolIndex?:number;approvalId?:string;reason?:string;status?:string;results?:unknown[]}
export interface ToolRun{ok?:boolean;missionId?:string;approvalId?:string;data?:any;error?:string}
export interface SupervisorDeps{
  think(prompt:string,opts?:{cloud?:boolean;images?:Array<{mimeType:string;base64:string}>}):Promise<string>;
  runAgent(goal:string,projectId:string,agentId:string,routing?:{preferLocal:boolean}):Promise<AgentRun>;
  resumeAgent(missionId:string,projectId:string,agentId:string,approvals:Record<number,string>,routing?:{preferLocal:boolean}):Promise<AgentRun>;
  runTool(projectId:string,tool:string,payload:Record<string,unknown>,resume?:{missionId:string;approvalId:string}):Promise<ToolRun>;
  isApproved(approvalId:string):boolean;
  cloudAvailable():boolean;
  externalAgent():{name:string;kind:"local"|"cloud"}|null;
  detect?(projectId:string):ProjectInfo|null;
  notify?(job:SupervisorJob,event:string):void;
}

const ACTIVE:JobStatus[]=["planning","running","waiting_approval","verifying"];
const AGENT_FOR:Record<MilestoneKind,string>={code:"coder",test:"tester",research:"researcher",desktop:"operator",business:"business",general:"core"};
const UI_WORDS=/\b(page|ui|ux|website|site|screen|design|layout|frontend|landing|dashboard|css|style)\b|صفحة|واجهة|موقع|تصميم|شاشة|لوحة|متجر إلكتروني|تطبيق ويب/i;
const MAX_ATTEMPTS=4;

function now(){return new Date().toISOString();}
function extractJson(raw:string):any{
  const text=raw.replace(/<think>[\s\S]*?<\/think>/gi,"").replace(/```(?:json)?/gi,"").trim();
  const start=text.indexOf("{"),end=text.lastIndexOf("}");
  if(start<0||end<=start)return null;
  try{return JSON.parse(text.slice(start,end+1));}catch{return null;}
}
const clip=(s:unknown,n=1500)=>{const t=typeof s==="string"?s:JSON.stringify(s??"");return t.length>n?t.slice(0,n)+"…":t;};

export class Supervisor{
  private jobs=new Map<string,SupervisorJob>();
  private running=new Set<string>();
  private readonly sleep:(ms:number)=>Promise<void>;
  private stopped=false;
  constructor(private readonly deps:SupervisorDeps,private readonly options:{file?:string;pollMs?:number;sleep?:(ms:number)=>Promise<void>;maxConcurrent?:number}={}){
    this.sleep=options.sleep??(ms=>new Promise(r=>setTimeout(r,ms)));
    this.load();
  }

  // ------------------------------------------------------------ public API
  create(goal:string,projectId="default",opts:{maxMinutes?:number;maxRounds?:number}={}):SupervisorJob{
    const g=goal.trim();if(g.length<3||g.length>4000)throw new Error("goal_required");
    const job:SupervisorJob={id:randomUUID(),projectId,goal:g,status:"planning",createdAt:now(),updatedAt:now(),
      deadline:new Date(Date.now()+Math.min(Math.max(opts.maxMinutes??120,5),24*60)*60_000).toISOString(),
      trust:trustLevel(projectId),acceptance:[],checks:null,milestones:[],current:0,rounds:0,maxRounds:Math.min(Math.max(opts.maxRounds??30,3),200),
      cloudUsed:false,externalUsed:[],checkpoints:[],log:[],finalRepairs:0};
    this.jobs.set(job.id,job);this.log(job,"Job created");this.save();
    void this.drive(job.id);
    return job;
  }
  list(projectId?:string){return[...this.jobs.values()].filter(j=>!projectId||j.projectId===projectId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  get(id:string){return this.jobs.get(id);}
  cancel(id:string){const j=this.jobs.get(id);if(!j)return false;if(ACTIVE.includes(j.status)){j.status="cancelled";j.result="Cancelled by the owner.";this.log(j,"Cancelled");this.save();}return true;}
  /** Resume jobs that were running when LayanX stopped. */
  start(){for(const j of this.jobs.values())if(ACTIVE.includes(j.status))void this.drive(j.id);}
  stop(){this.stopped=true;}

  // ------------------------------------------------------------ persistence
  private load(){
    if(!this.options.file)return;
    try{const raw=JSON.parse(fs.readFileSync(this.options.file,"utf8")) as SupervisorJob[];for(const j of raw)this.jobs.set(j.id,j);}catch{}
  }
  private save(){
    if(!this.options.file)return;
    const list=[...this.jobs.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,200);
    fs.mkdirSync(path.dirname(this.options.file),{recursive:true});
    const tmp=this.options.file+".tmp";fs.writeFileSync(tmp,JSON.stringify(list));fs.renameSync(tmp,this.options.file);
  }
  private log(job:SupervisorJob,msg:string,level:JobLog["level"]="info"){job.log.push({at:now(),msg:msg.slice(0,600),level});if(job.log.length>300)job.log.splice(0,job.log.length-300);job.updatedAt=now();}
  private set(job:SupervisorJob,status:JobStatus,msg?:string){job.status=status;if(msg)this.log(job,msg,status==="failed"?"error":"info");this.save();this.deps.notify?.(job,status);}

  // ------------------------------------------------------------ main loop
  private async drive(id:string){
    if(this.running.has(id))return;
    this.running.add(id);
    try{
      while(!this.stopped){
        const job=this.jobs.get(id);
        if(!job||!ACTIVE.includes(job.status))break;
        if(Date.now()>Date.parse(job.deadline)){job.result="Time budget used up.";this.set(job,"budget_exhausted","Stopped: time budget used up");break;}
        if(job.rounds>=job.maxRounds){job.result="Round budget used up.";this.set(job,"budget_exhausted","Stopped: round budget used up");break;}
        try{await this.step(job);}
        catch(error){this.log(job,"Error: "+(error as Error).message,"error");job.rounds++;this.save();await this.sleep(this.options.pollMs??2000);}
      }
    }finally{this.running.delete(id);}
  }

  private async step(job:SupervisorJob){
    if(job.status==="waiting_approval")return this.waitForApproval(job);
    if(job.status==="planning")return this.plan(job);
    if(job.status==="verifying")return this.finalVerification(job);
    const m=job.milestones[job.current];
    if(!m){this.set(job,"verifying","All milestones done, final verification");return;}
    await this.runMilestone(job,m);
  }

  // ------------------------------------------------------------ 1+2. spec and baseline
  private info(job:SupervisorJob):ProjectInfo|null{
    try{return this.deps.detect?this.deps.detect(job.projectId):detectProject(projectDir(job.projectId));}catch{return null;}
  }
  private async plan(job:SupervisorJob){
    const info=this.info(job);
    // Playbooks/skills that came with the project files are not "discovered by research": they stay quarantined.
    if(!job.discovered)job.discovered=listPlaybooks(job.projectId).filter(p=>p.source==="project").map(p=>p.id);
    try{if(info)refreshKnowledge(projectDir(job.projectId));}catch{}
    const notes=knowledgeSummary(job.projectId,3000);
    const playbooks=matchPlaybooks({goal:job.goal,...(info?{stack:info.stack}:{}),projectId:job.projectId},2);
    const lessons=findLessons({goal:job.goal,...(info?{stack:info.stack}:{}),projectId:job.projectId},5);
    job.playbooks=playbooks.map(p=>p.id);job.lessons=lessons.map(l=>l.id);
    if(playbooks.length||lessons.length)this.log(job,`Using ${playbooks.length} playbook(s)${playbooks.length?": "+playbooks.map(p=>p.title).join(", "):""}; ${lessons.length} lesson(s) from past work`);
    const prompt=[
      "You are the planning lead of an autonomous software and business agent. Return ONLY JSON.",
      'Schema: {"acceptance":["checkable outcome",...],"milestones":[{"title":"short","goal":"what to do","kind":"code|test|research|desktop|business|general"}],"checks":{"install":bool,"test":bool,"build":bool,"typecheck":bool,"lint":bool,"browser":{"path":"/"}|null}}',
      "Rules: 1-6 milestones, smallest safe steps, reuse and edit existing code instead of rewriting, never delete working features.",
      "Set checks to what really proves the goal for this project. browser is for anything visible in a web page.",
      `Project: ${JSON.stringify(info?{stack:info.stack,scripts:info.scripts,git:info.git}:{stack:"unknown"})}`,
      notes?`Project memory (build on it, respect decisions, do not duplicate existing modules):\n${clip(notes,3000)}`:"",
      playbooks.length||lessons.length?guidanceText(playbooks,lessons,2400):"",
      "If the goal needs a technology, API or service that neither the project memory nor a playbook covers, make the FIRST milestone kind \"research\": read the official documentation and write a short playbook to .layanx/playbooks/<topic>.md (steps, pitfalls, how to test) that the next milestones follow.",
      `Goal: ${job.goal}`
    ].filter(Boolean).join("\n");
    let spec:any=null;
    try{spec=extractJson(await this.deps.think(prompt));}catch(e){this.log(job,"Local planner failed: "+(e as Error).message,"warn");}
    if(!spec?.milestones?.length&&this.deps.cloudAvailable()){
      try{spec=extractJson(await this.deps.think(prompt,{cloud:true}));if(spec){job.cloudUsed=true;this.log(job,"Planned with a cloud model (the local one could not)");}}catch{}
    }
    const kinds:MilestoneKind[]=["code","test","research","desktop","business","general"];
    const milestones:Milestone[]=(Array.isArray(spec?.milestones)?spec.milestones:[]).slice(0,6)
      .filter((m:any)=>m&&typeof m.goal==="string"&&m.goal.trim())
      .map((m:any)=>{const kind:MilestoneKind=kinds.includes(m.kind)?m.kind:"code";return{title:String(m.title||m.goal).slice(0,120),goal:String(m.goal).slice(0,1500),kind,agent:AGENT_FOR[kind],status:"pending" as const,attempts:0,missions:[]};});
    if(!milestones.length)milestones.push({title:job.goal.slice(0,120),goal:job.goal,kind:"code",agent:"coder",status:"pending",attempts:0,missions:[]});
    const canRun=(t:string)=>Boolean(info&&(info.stack!=="node"?["install","test","build"].includes(t):info.scripts.includes(t)||t==="install"));
    const c=spec?.checks??{};
    job.checks={
      install:Boolean(info&&info.stack!=="unknown"&&(c.install??true)),
      test:canRun("test")&&c.test!==false,build:canRun("build")&&c.build!==false,
      typecheck:canRun("typecheck")&&c.typecheck!==false,lint:canRun("lint")&&c.lint===true,
      security:Boolean(info&&info.stack!=="unknown"&&c.security!==false),
      browser:(c.browser&&typeof c.browser==="object")||(UI_WORDS.test(job.goal)&&info?.scripts.some(s=>["dev","start","serve"].includes(s)))?{path:typeof c.browser?.path==="string"&&c.browser.path.startsWith("/")?c.browser.path:"/"}:null
    };
    job.acceptance=(Array.isArray(spec?.acceptance)?spec.acceptance:[]).filter((a:unknown)=>typeof a==="string").slice(0,10);
    if(!job.acceptance.length)job.acceptance=[job.goal];
    job.milestones=milestones;
    this.log(job,`Plan: ${milestones.length} milestone(s); checks: ${Object.entries(job.checks).filter(([,v])=>v).map(([k])=>k).join(", ")||"none"}`);
    if(job.checks.install){const r=await this.tool(job,"project.run",{task:"install"});if(r==="waiting")return;}
    job.baseline=await this.runChecks(job);
    if(job.baseline===undefined)return;
    this.log(job,"Baseline: "+job.baseline.map(c=>`${c.name} ${c.skipped?"skip":c.ok?"ok":"FAIL"}`).join(", "));
    if(info?.git&&!job.branch){
      // Never work on main/master directly: one branch per job keeps main intact if something goes wrong.
      const st=await this.deps.runTool(job.projectId,"git.status",{});
      const out=String(st.data?.stdout??"");
      const current=/^## (?:No commits yet on )?([^\s.]+)/m.exec(out)?.[1]??/On branch (\S+)/.exec(out)?.[1];
      if(current==="main"||current==="master"){
        const slug=job.goal.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,24)||"task";
        const name=`layanx/${new Date().toISOString().slice(0,10)}-${slug}-${job.id.slice(0,6)}`;
        const r=await this.tool(job,"git.branch",{branch:name});
        if(r==="waiting")return;
        if(r.ok){job.branch=name;this.log(job,`Working on branch ${name} (main stays untouched)`);}
        else this.log(job,"Could not create a work branch: "+(r.error??"unknown"),"warn");
      }else if(current){job.branch=current;}
    }
    this.set(job,"running");
  }

  // ------------------------------------------------------------ 3-5. milestones, gates, repair, escalation
  private async runMilestone(job:SupervisorJob,m:Milestone){
    job.rounds++;m.attempts++;m.status="running";
    const escalate=m.attempts>2&&this.deps.cloudAvailable();
    const external=m.kind==="code"&&m.attempts===3?this.deps.externalAgent():null;
    this.log(job,`Milestone ${job.current+1}/${job.milestones.length} attempt ${m.attempts}: ${m.title}`+(escalate?" (cloud model)":"")+(external?` (with ${external.name})`:""));
    if(escalate)job.cloudUsed=true;
    if(external){
      const r=await this.tool(job,"agent.external",{agent:external.name,task:this.taskText(job,m)});
      if(r==="waiting")return;
      if(!job.externalUsed.includes(external.name))job.externalUsed.push(external.name);
    }else{
      let run:AgentRun;
      try{run=await this.deps.runAgent(this.taskText(job,m),job.projectId,m.agent,escalate?{preferLocal:false}:undefined);}
      catch(error){run={completed:false,reason:(error as Error).message};}
      if(run.missionId)m.missions.push(run.missionId);
      if(run.paused&&run.approvalId&&run.missionId){
        job.waiting={approvalId:run.approvalId,missionId:run.missionId,index:run.nextToolIndex??0,kind:"agent",agentId:m.agent,milestone:job.current};
        this.set(job,"waiting_approval","Waiting for your approval to continue");return;
      }
      if(!run.completed)m.notes=`Agent stopped: ${run.reason??run.status??"unknown"}`;
    }
    await this.afterWork(job,m);
  }

  private async afterWork(job:SupervisorJob,m:Milestone){
    const previousFailure=m.attempts>1?m.notes:undefined;
    const checks=await this.runChecks(job);
    if(checks===undefined)return;
    job.lastChecks=checks;
    const failed=checks.filter(c=>!c.ok&&!c.skipped);
    const regressions=(job.baseline??[]).filter(b=>b.ok&&!b.skipped&&checks.some(c=>c.name===b.name&&!c.ok&&!c.skipped)).map(b=>b.name);
    const agentFailed=Boolean(m.notes&&m.notes.startsWith("Agent stopped"));
    if(!failed.length&&!agentFailed){
      m.status="done";m.notes=undefined;
      if(previousFailure)await this.learnFix(job,m,previousFailure);
      if(m.kind==="research")this.importProjectPlaybooks(job);
      this.log(job,`Milestone passed: ${m.title}`+(checks.length?` (${checks.filter(c=>!c.skipped).map(c=>c.name).join(", ")||"no checks"})`:""));
      await this.checkpoint(job,m);
      job.current++;this.save();return;
    }
    m.notes=[agentFailed?m.notes:"",regressions.length?`REGRESSION (passed before, fails now): ${regressions.join(", ")}`:"",...failed.map(c=>`${c.name} failed:\n${c.summary}`)].filter(Boolean).join("\n\n");
    this.log(job,`Checks failed for "${m.title}": ${failed.map(c=>c.name).join(", ")||"agent did not finish"}`+(regressions.length?` — regression in ${regressions.join(", ")}`:""),"warn");
    if(m.attempts>=MAX_ATTEMPTS){m.status="failed";job.result=`Could not complete "${m.title}" after ${m.attempts} attempts. Last problem:\n${clip(m.notes,800)}`;
      try{recordIssue(projectDir(job.projectId),`Unfinished: ${m.title}`,`Autonomous job "${job.goal.split("\n")[0]!.slice(0,80)}" stopped. ${clip(m.notes,300)}`);}catch{}
      this.finished(job,false);
      this.set(job,"failed","Stopped: milestone keeps failing");return;}
    m.status="pending";this.save();
  }

  private taskText(job:SupervisorJob,m:Milestone):string{
    return[
      `Overall goal: ${job.goal}`,
      `Acceptance criteria: ${job.acceptance.join(" | ")}`,
      `Current milestone (${job.current+1}/${job.milestones.length}): ${m.goal}`,
      m.notes?`The previous attempt failed. Fix exactly this, change as little as possible:\n${clip(m.notes,3000)}`:"",
      (()=>{const k=knowledgeSummary(job.projectId,1500);return k?`Project memory:\n${k}`:"";})(),
      (()=>{try{const map=buildRepoMap(projectDir(job.projectId),{focus:job.goal+" "+m.goal,tokenBudget:700});return map.text?`Code map (existing functions to reuse; check callers before changing them):\n${map.text}`:"";}catch{return"";}})(),
      (()=>{const pbs=listPlaybooks(job.projectId).filter(p=>(job.playbooks??[]).includes(p.id)||(p.source==="project"&&p.status==="active"));
        const forError=m.notes?findLessons({error:m.notes,goal:m.goal,projectId:job.projectId},3):[];
        if(forError.length)this.log(job,`Known fix(es) for this error: ${forError.length}`);
        const planned=listLessons().filter(l=>(job.lessons??[]).includes(l.id)&&!forError.some(f=>f.id===l.id)).slice(0,3);
        const ls=[...forError,...planned];
        const g=guidanceText(pbs.slice(0,2),ls,1800);return g?`Guidance:\n${g}`:"";})(),
      "Rules: work only inside this project; read project.knowledge before large changes; edit existing files instead of rewriting them;",
      "keep everything that already works; use project.run (install/test/build/typecheck/lint/dev:start) to verify;",
      "record important choices with project.knowledge.record (type decision); do not push, publish or send anything."
    ].filter(Boolean).join("\n");
  }

  // ------------------------------------------------------------ tools through the runtime (approvals respected)
  private async tool(job:SupervisorJob,tool:string,payload:Record<string,unknown>):Promise<ToolRun|"waiting">{
    const r=await this.deps.runTool(job.projectId,tool,payload);
    if(!r.ok&&r.approvalId&&r.missionId){
      job.waiting={approvalId:r.approvalId,missionId:r.missionId,index:0,kind:"tool",tool,payload,milestone:job.current};
      this.set(job,"waiting_approval",`Waiting for your approval: ${tool} ${payload.task??payload.agent??""}`);return"waiting";
    }
    return r;
  }
  private async waitForApproval(job:SupervisorJob){
    const w=job.waiting;
    if(!w){this.set(job,"running");return;}
    if(!this.deps.isApproved(w.approvalId)){await this.sleep(this.options.pollMs??2000);return;}
    job.waiting=undefined;this.set(job,job.milestones[w.milestone]?"running":"verifying","Approved, continuing");
    const m=job.milestones[w.milestone];
    if(w.kind==="agent"&&m){
      const run=await this.deps.resumeAgent(w.missionId,job.projectId,w.agentId??m.agent,{[w.index]:w.approvalId});
      if(run.paused&&run.approvalId){job.waiting={approvalId:run.approvalId,missionId:w.missionId,index:run.nextToolIndex??0,kind:"agent",agentId:w.agentId,milestone:w.milestone};this.set(job,"waiting_approval","Waiting for another approval");return;}
      if(!run.completed)m.notes=`Agent stopped: ${run.reason??run.status??"unknown"}`;
      await this.afterWork(job,m);return;
    }
    if(w.kind==="tool"){
      await this.deps.runTool(job.projectId,w.tool!,w.payload??{},{missionId:w.missionId,approvalId:w.approvalId});
      if(w.tool==="agent.external"&&m)await this.afterWork(job,m);
      // install / checks / dev server: the next step re-runs whatever was waiting
      if(job.status==="running"&&!job.baseline&&job.milestones.length&&job.current===0&&w.tool==="project.run"&&w.payload?.task==="install"){job.baseline=await this.runChecks(job);this.save();}
    }
  }

  private async runChecks(job:SupervisorJob):Promise<CheckResult[]|undefined>{
    const c=job.checks;if(!c)return[];
    const out:CheckResult[]=[];
    for(const name of ["typecheck","lint","test","build"] as const){
      if(!c[name])continue;
      const r=await this.tool(job,"project.run",{task:name});
      if(r==="waiting")return undefined;
      const d=r.data??{};
      const ok=Boolean(r.ok&&(d.ok??d.exitCode===0));
      out.push({name,ok,summary:ok?"passed":clip(String(d.stderr||"")+"\n"+String(d.stdout||"")||r.error||"failed",2000)});
    }
    return out;
  }

  // ------------------------------------------------------------ 6. visual + final verification
  private async finalVerification(job:SupervisorJob){
    job.rounds++;
    const c=job.checks;
    const final=await this.runChecks(job);
    if(final===undefined)return;
    const failing=final.filter(x=>!x.ok&&!x.skipped);
    if(failing.length)return this.reopen(job,"Final checks failed:\n"+failing.map(f=>`${f.name}: ${f.summary}`).join("\n"));
    if(c?.browser){
      const dev=await this.tool(job,"project.run",{task:"dev:start"});
      if(dev==="waiting")return;
      const url=dev.data?.url as string|undefined;
      if(!url){this.log(job,"Dev server did not report a URL; visual check skipped","warn");}
      else{
        const target=url.replace(/\/$/,"")+(c.browser.path||"/");
        const t=await this.tool(job,"browser.test",{url:target,viewports:["desktop","mobile"],baseline:"final"});
        if(t==="waiting")return;
        const data=t.data??{};
        const problems:string[]=Array.isArray(data.problems)?data.problems:t.ok?[]:[t.error??"browser test failed"];
        const shots=(data.results??[]).map((r:any)=>r.screenshot).filter((s:any)=>s?.base64);
        let judgement:string|undefined;
        if(shots.length){
          try{
            const raw=await this.deps.think([
              "You review a finished web page against acceptance criteria. Return ONLY JSON {\"ok\":bool,\"issues\":[\"...\"]}.",
              "Judge only what is visible: layout broken, text missing, overlapping elements, empty page, obvious errors.",
              `Acceptance criteria: ${job.acceptance.join(" | ")}`
            ].join("\n"),{images:shots.slice(0,2).map((s:any)=>({mimeType:s.mimeType,base64:s.base64}))});
            const j=extractJson(raw);
            if(j&&j.ok===false&&Array.isArray(j.issues))problems.push(...j.issues.slice(0,5).map((i:unknown)=>"visual: "+String(i)));
            judgement=j?(j.ok?"ok":"issues"):undefined;
          }catch{}
        }
        job.visual={url:target,problems,judgement,screens:(data.results??[]).map((r:any)=>r.viewport)};
        try{updateHealth(projectDir(job.projectId),"visual",{ok:!problems.length,summary:problems.slice(0,3).join("; ")||"clean"});}catch{}
        if(!problems.length){const sec=await this.securityGate(job,url);if(sec==="waiting")return;if(sec){await this.deps.runTool(job.projectId,"project.run",{task:"dev:stop"}).catch(()=>undefined);return this.reopen(job,sec);}}
        await this.deps.runTool(job.projectId,"project.run",{task:"dev:stop"}).catch(()=>undefined);
        if(problems.length)return this.reopen(job,"Browser check found problems:\n"+problems.join("\n"));
      }
    }
    if(c?.security&&!c.browser&&(!job.security||job.security.blocked)){const sec=await this.securityGate(job);if(sec==="waiting")return;if(sec)return this.reopen(job,sec);}
    writeProjectNotes(job);
    try{refreshKnowledge(projectDir(job.projectId));}catch{}
    await this.commitNotes(job);
    job.result=`Done: ${job.milestones.length} milestone(s), checks ${final.map(f=>f.name).join(", ")||"none"} passing`+(job.visual?`, visual check ${job.visual.problems.length?"with issues":"clean"}`:"")+(job.security?`, security score ${job.security.score}/100`:"")+(job.branch?`, branch ${job.branch}`:"");
    this.finished(job,true);
    await this.learnPlaybook(job);
    this.set(job,"completed","Completed and verified");
  }
  // ------------------------------------------------------------ learning
  private stack(job:SupervisorJob){return this.info(job)?.stack??"unknown";}
  private finished(job:SupervisorJob,success:boolean){
    recordPlaybookOutcome(job.playbooks??[],success);markLessons(job.lessons??[],success);
    if(!success)try{recordLesson({projectId:job.projectId,stack:this.stack(job),kind:"pitfall",trigger:job.goal,text:`Approach that did not finish "${job.goal.split("\n")[0]!.slice(0,100)}": ${clip(job.result??"",350)}`});}catch{}
  }
  /** A milestone failed and then passed: remember what fixed it, keyed by the error signature. */
  private async learnFix(job:SupervisorJob,m:Milestone,failure:string){
    const signature=errorSignature(failure);
    let diff="";try{const d=await this.deps.runTool(job.projectId,"git.diff",{});diff=String(d.data?.stdout??"").slice(0,2500);}catch{}
    let text=`"${m.title}" failed with ${signature??clip(failure,160)}; it passed after ${m.attempts} attempts${diff?" by changing "+[...new Set([...diff.matchAll(/^diff --git a\/(\S+)/gm)].map(x=>x[1]))].slice(0,5).join(", "):""}.`;
    let tags:string[]=[];
    try{
      const j=extractJson(await this.deps.think([
        "Write ONE reusable lesson (max 2 sentences) from this fix, so the same error is fixed faster next time. Return ONLY JSON {\"lesson\":\"...\",\"tags\":[\"...\"]}.",
        `Error:\n${clip(failure,1500)}`,diff?`Change that fixed it:\n${diff}`:""].filter(Boolean).join("\n")));
      if(j&&typeof j.lesson==="string"&&j.lesson.trim().length>10)text=j.lesson.trim();
      if(Array.isArray(j?.tags))tags=j.tags.filter((t:unknown)=>typeof t==="string").slice(0,8);
    }catch{}
    const lesson=recordLesson({projectId:job.projectId,stack:this.stack(job),kind:"fix",...(signature?{signature}:{}),trigger:clip(failure,280),text,tags});
    (job.learned??=[]).push("lesson:"+lesson.id);
    this.log(job,"Learned: "+clip(text,200));
  }
  /** A research milestone wrote playbooks into .layanx/playbooks: use them here, propose them globally. */
  private importProjectPlaybooks(job:SupervisorJob){
    for(const p of listPlaybooks(job.projectId).filter(x=>x.source==="project")){
      if((job.discovered??[]).includes(p.id))continue;
      (job.discovered??=[]).push(p.id);
      if(p.status==="rejected"){this.log(job,`Ignored playbook "${p.title}": it failed the safety scan`,"warn");continue;}
      // Written by this job's research: trusted in this project for exactly this content.
      trustProjectPlaybook(job.projectId,p.id);
      const copy=savePlaybookCandidate({title:p.title,tags:p.tags,stacks:p.stacks,body:p.body,note:`Discovered by research in project ${job.projectId}; waiting for the owner's approval.`});
      (job.learned??=[]).push(copy.id);
      this.log(job,`New playbook from research: "${p.title}" (used in this project; global copy waits for approval)`);
    }
  }
  /** After a job that needed several steps or repairs, propose a playbook for the next similar task. */
  private async learnPlaybook(job:SupervisorJob){
    const repaired=job.milestones.some(m=>m.attempts>1)||job.finalRepairs>0;
    if(job.milestones.length<2&&!repaired)return;
    try{
      const j=extractJson(await this.deps.think([
        "Write a short reusable playbook for this KIND of task, based on what worked. Return ONLY JSON",
        '{"title":"...","tags":["keywords in English and Arabic"],"stacks":["node|python|flutter|dotnet|any"],"steps":["..."],"pitfalls":["..."],"checks":["..."]}',
        `Task: ${job.goal}`,`Milestones: ${job.milestones.map(m=>`${m.title}${m.attempts>1?` (needed ${m.attempts} attempts)`:""}`).join("; ")}`,
        `Checks that proved it: ${(job.lastChecks??[]).map(c=>c.name).join(", ")||"none"}${job.visual?", browser":""}${job.security?", security":""}`].join("\n")));
      if(!j||typeof j.title!=="string"||!Array.isArray(j.steps)||!j.steps.length)return;
      const body=[...j.steps.slice(0,12).map((x:unknown,i:number)=>`${i+1}. ${String(x)}`),...(Array.isArray(j.pitfalls)&&j.pitfalls.length?["Pitfalls: "+j.pitfalls.slice(0,6).map(String).join("; ")]:[]),...(Array.isArray(j.checks)&&j.checks.length?["Checks: "+j.checks.slice(0,6).map(String).join("; ")]:[])].join("\n");
      const p=savePlaybookCandidate({title:j.title,tags:Array.isArray(j.tags)?j.tags.map(String):[],stacks:Array.isArray(j.stacks)?j.stacks.map(String):[this.stack(job)],body,note:`Learned from job "${job.goal.split("\n")[0]!.slice(0,80)}"; waiting for the owner's approval.`});
      (job.learned??=[]).push(p.id);
      this.log(job,p.status==="rejected"?`Proposed playbook rejected by the safety scan: ${p.title}`:`Proposed a new playbook for approval: "${p.title}"`);
    }catch{}
  }

  /** Returns a problem text when critical/high findings must be fixed first, undefined when clean. */
  private async securityGate(job:SupervisorJob,url?:string):Promise<string|undefined|"waiting">{
    const r=await this.tool(job,"project.security",{audit:true,...(url?{url}:{})});
    if(r==="waiting")return"waiting";
    const d=r.data??{};
    if(typeof d.score!=="number"){this.log(job,"Security scan unavailable: "+(r.error??"no report"),"warn");return undefined;}
    job.security={score:d.score,blocked:Boolean(d.blocked),counts:d.counts??{}};
    this.log(job,`Security score ${d.score}/100 (${d.counts?.critical??0} critical, ${d.counts?.high??0} high, ${d.counts?.medium??0} medium)`,d.blocked?"warn":"info");
    if(!d.blocked)return undefined;
    const serious=(d.findings??[]).filter((f:any)=>(f.severity==="critical"||f.severity==="high")&&!f.test).slice(0,12);
    return"Security check found problems that must be fixed before delivery:\n"+serious.map((f:any)=>`- [${f.severity}] ${f.message}${f.file?` (${f.file}:${f.line??""})`:""} — ${f.fix}`).join("\n");
  }
  private reopen(job:SupervisorJob,problem:string){
    if(job.finalRepairs>=2){job.result="Final verification keeps failing:\n"+clip(problem,800);this.finished(job,false);this.set(job,"failed","Stopped: final verification keeps failing");return;}
    job.finalRepairs++;
    job.milestones.push({title:"Fix final verification",goal:"Fix these problems found during the final verification without breaking anything else.",kind:"code",agent:"coder",status:"pending",attempts:0,missions:[],notes:problem});
    this.set(job,"running","Final verification found problems; added a repair milestone");
  }

  /** Commit the project memory written at the end, so the work branch is clean and can be merged. */
  private async commitNotes(job:SupervisorJob){
    const info=this.info(job);if(!info?.git)return;
    const add=await this.deps.runTool(job.projectId,"git.add",{path:".layanx"});
    if(!add.ok){if(add.approvalId)this.log(job,"Project notes not committed: committing needs approval at this trust level","warn");return;}
    const c=await this.deps.runTool(job.projectId,"git.commit",{message:"LayanX: project notes"});
    if(c.ok)this.log(job,"Project notes committed");
  }

  // ------------------------------------------------------------ 7. checkpoints
  private async checkpoint(job:SupervisorJob,m:Milestone){
    const info=this.info(job);if(!info?.git)return;
    const add=await this.deps.runTool(job.projectId,"git.add",{path:"."});
    if(!add.ok){if(add.approvalId)this.log(job,"Checkpoint skipped: committing needs approval at this trust level","warn");return;}
    const commit=await this.deps.runTool(job.projectId,"git.commit",{message:`LayanX: ${m.title}`.slice(0,190)});
    if(commit.ok){job.checkpoints.push(m.title);this.log(job,"Checkpoint commit: "+m.title);}
  }
}

// ---------------------------------------------------------------- 8. project notes (.layanx/)
export function readProjectNotes(projectId:string):string{
  try{const dir=path.join(projectDir(projectId),".layanx");return["PROJECT.md","DECISIONS.md"].map(f=>{const p=path.join(dir,f);return fs.existsSync(p)?fs.readFileSync(p,"utf8").slice(0,4000):"";}).filter(Boolean).join("\n\n");}catch{return"";}
}
export function writeProjectNotes(job:SupervisorJob){
  try{
    const dir=path.join(projectDir(job.projectId),".layanx");fs.mkdirSync(dir,{recursive:true});
    const projectFile=path.join(dir,"PROJECT.md");
    if(!fs.existsSync(projectFile)){
      const info=(()=>{try{return detectProject(projectDir(job.projectId));}catch{return null;}})();
      fs.writeFileSync(projectFile,[`# ${job.projectId}`,"",`Stack: ${info?.stack??"unknown"}`,info?.scripts.length?`Scripts: ${info.scripts.join(", ")}`:"","",
        "## Purpose","(LayanX keeps this file. Add what the project is for and anything the agent must respect.)","",
        "## How to verify",...(job.checks?Object.entries(job.checks).filter(([k,v])=>v&&k!=="browser").map(([k])=>`- ${k}`):[]),""].join("\n"));
    }
    const entry=[`## ${new Date().toISOString().slice(0,16).replace("T"," ")} — ${job.goal.split("\n")[0]!.slice(0,120)}`,
      ...job.milestones.map(m=>`- [${m.status==="done"?"x":" "}] ${m.title}`),
      `- Checks: ${(job.lastChecks??[]).map(c=>`${c.name} ${c.ok?"ok":"fail"}`).join(", ")||"none"}`,
      job.visual?`- Visual: ${job.visual.url} ${job.visual.problems.length?"issues: "+job.visual.problems.join("; "):"clean"}`:"",
      job.checkpoints.length?`- Commits: ${job.checkpoints.length}`:"",""].filter(Boolean).join("\n");
    fs.appendFileSync(path.join(dir,"CHANGELOG.md"),entry+"\n");
  }catch{}
}
