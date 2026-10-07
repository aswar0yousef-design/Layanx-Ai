import type {LayanXCore} from "../core/orchestrator.js";
import type {AgentContract} from "../core/contracts.js";
import {createProjectRunnerAdapter} from "./project-runner.js";
import {createBrowserTestAdapter} from "./browser-test.js";
import {createExternalAgentAdapter} from "./external-agents.js";
import {createSecurityScanAdapter} from "./security-scan.js";
import {knowledgeSummary,openIssues,recordDecision,recordIssue,refreshKnowledge,resolveIssue} from "./knowledge.js";
import {projectDir} from "./project-dir.js";
import {createMergeAdapter,createPublishPrAdapter} from "./integrate.js";
import {detectProject} from "./project-runner.js";
import {findLessons,matchPlaybooks,recordLesson,listPlaybooks} from "./learning.js";
import {buildRepoMap,findReferences} from "./repo-map.js";

/** Phase 1 tools: build/check projects, look at web pages, delegate to coding agents. */
export function registerAutonomyTools(core:LayanXCore,options:{coding:boolean}):void{
  if(!options.coding)return;
  core.tools.register({name:"project.run",description:"build and check the project without a free shell: payload.task = detect | install | test | build | lint | typecheck | script (payload.script) | dev:start | dev:status | dev:stop. Works for Node, Python, Flutter and .NET projects.",
    permission:"L4_EXECUTE",dangerous:true,actions:["run project task","install dependencies","run tests","build project","start dev server","تشغيل مهمة المشروع","تثبيت الحزم","تشغيل الاختبارات","بناء المشروع","تشغيل خادم التطوير"],
    tags:["project","build","test","install","dev","server","npm","pytest","flutter","dotnet","verify","مشروع","اختبار","بناء"]});
  core.toolAdapters.register("project.run",createProjectRunnerAdapter());
  core.tools.register({name:"browser.test",description:"open a web page in a real browser, run steps (click, fill, press, wait, expectText, snapshot), return the page as text (pageText) so models without vision can read it, collect console/page/network errors, accessibility basics and screenshots on desktop and mobile, compare with a saved baseline. payload: {url, steps?, viewports?, baseline?, updateBaseline?}",
    permission:"L2_ANALYZE",dangerous:false,actions:["test web page","visual test","open page in browser","اختبار الصفحة","اختبار بصري","فحص الواجهة"],
    tags:["browser","ui","visual","test","screenshot","frontend","website","واجهة","اختبار","موقع"]});
  core.toolAdapters.register("browser.test",createBrowserTestAdapter());
  core.tools.register({name:"agent.external",description:"delegate a focused coding task to a specialised coding agent inside the project folder: aider (local Ollama), claude-code or codex (cloud, only if allowed). payload: {agent:\"auto\"|\"aider\"|\"claude-code\"|\"codex\", task}. Always verify afterwards with project.run.",
    permission:"L4_EXECUTE",dangerous:true,actions:["delegate coding task","run coding agent","تفويض مهمة برمجة","تشغيل وكيل برمجة"],
    tags:["agent","coding","aider","claude","codex","delegate","refactor","fix","برمجة","وكيل"]});
  core.toolAdapters.register("agent.external",createExternalAgentAdapter());

  // ---- Phase 2: project memory and security
  core.tools.register({name:"project.knowledge",description:"read the project's memory before changing it: purpose, folder map, entry points, decisions, open issues, recent changes, health. payload.refresh=true re-indexes the files.",
    permission:"L1_READ",dangerous:false,actions:["read project knowledge","project memory","project map","قراءة ذاكرة المشروع","خريطة المشروع"],tags:["project","knowledge","memory","architecture","map","ذاكرة","مشروع"]});
  core.toolAdapters.register("project.knowledge",{async execute(request){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const dir=projectDir(request.projectId);
    const index=input.refresh===true?refreshKnowledge(dir):undefined;
    return{summary:knowledgeSummary(request.projectId??"default",6000)||"No project memory yet.",openIssues:openIssues(dir),...(index?{index}:{})};
  }});
  core.tools.register({name:"project.code_map",description:"the project's important functions, classes and types with their signatures, ranked by how much the rest of the code uses them (repo map). payload.focus = words from the task to rank related code first, payload.tokens = size (default 1500). Read it before writing code so you reuse what exists.",
    permission:"L1_READ",dangerous:false,actions:["code map","repo map","map project symbols","خريطة الكود","خريطة الدوال"],tags:["project","code","symbols","repo-map","functions","classes","كود","دوال"]});
  core.toolAdapters.register("project.code_map",{async execute(request){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const tokens=typeof input.tokens==="number"?input.tokens:1500;
    const map=buildRepoMap(projectDir(request.projectId),{tokenBudget:tokens,...(typeof input.focus==="string"?{focus:input.focus.slice(0,500)}:{})});
    return{map:map.text||"No source files found.",files:map.files,definitions:map.definitions,truncated:map.truncated,topFiles:map.ranked.slice(0,10).map(r=>r.file)};
  }});
  core.tools.register({name:"project.references",description:"find where a function, class or variable is defined and every line that uses it (payload.symbol). Run it before changing or renaming something so every caller is updated and tested.",
    permission:"L1_READ",dangerous:false,actions:["find references","who uses symbol","find usages","البحث عن الاستخدامات","من يستخدم الدالة"],tags:["project","code","references","usages","impact","refactor","استخدامات","تأثير"]});
  core.toolAdapters.register("project.references",{async execute(request){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const symbol=typeof input.symbol==="string"?input.symbol.trim():"";
    return{symbol,...findReferences(projectDir(request.projectId),symbol,{maxResults:typeof input.limit==="number"?input.limit:200})};
  }});
  core.tools.register({name:"project.knowledge.record",description:"write to the project's memory: payload.type = decision (title + why) | issue (title + detail) | resolve (title). Record why you chose an approach and any problem you could not fix.",
    permission:"L3_MODIFY",dangerous:false,actions:["record project decision","record known issue","resolve known issue","تسجيل قرار","تسجيل مشكلة","حل مشكلة"],tags:["project","knowledge","decision","issue","memory","ذاكرة"]});
  core.toolAdapters.register("project.knowledge.record",{async execute(request){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const dir=projectDir(request.projectId);
    const title=typeof input.title==="string"?input.title.trim():"";
    if(title.length<3)throw new Error("title is required.");
    const detail=typeof input.why==="string"?input.why:typeof input.detail==="string"?input.detail:"";
    if(input.type==="decision"){recordDecision(dir,title,detail||"(no reason given)",request.agentId);return{recorded:"decision",title};}
    if(input.type==="issue"){recordIssue(dir,title,detail);return{recorded:"issue",title};}
    if(input.type==="resolve")return{resolved:resolveIssue(dir,title),title};
    throw new Error("type must be decision, issue or resolve.");
  }});
  core.tools.register({name:"project.security",description:"security check of the project being built: hard-coded secrets, injection, XSS, disabled TLS, CORS, cookies, JWT, weak crypto, debug mode, vulnerable dependencies (npm audit, osv-scanner), and with payload.url (an app running on this computer) a passive web baseline like OWASP ZAP: CSP, frame protection, cookies, CORS, error leaks, SRI, exposed .env/.git, plus real ZAP in Docker when available. Returns a 0-100 score; critical/high findings block delivery.",
    permission:"L2_ANALYZE",dangerous:false,actions:["security scan","scan project security","فحص أمني","فحص أمان المشروع"],tags:["security","scan","audit","vulnerability","owasp","أمان","فحص"]});
  core.toolAdapters.register("project.security",createSecurityScanAdapter());

  // ---- Phase 3: bring a work branch home
  core.tools.register({name:"git.merge",description:"merge a LayanX work branch into main/master locally with --no-ff; aborts cleanly on conflicts. payload: {branch, into?}",
    permission:"L4_EXECUTE",dangerous:true,actions:["merge branch","دمج الفرع"],tags:["git","merge","branch","دمج"]});
  core.toolAdapters.register("git.merge",createMergeAdapter());
  core.tools.register({name:"git.publish_pr",description:"push a branch to origin and open a GitHub pull request (needs GITHUB_TOKEN, otherwise returns the compare link). payload: {branch, base?, title?, body?}",
    permission:"L4_EXECUTE",dangerous:true,actions:["publish pull request","open pull request","نشر طلب دمج"],tags:["git","github","pull request","pr","push"]});
  core.toolAdapters.register("git.publish_pr",createPublishPrAdapter());

  // ---- Phase 4: learning
  core.tools.register({name:"learning.search",description:"before starting a task (or when stuck on an error) find playbooks (how-to guides) and lessons from past work. payload: {query, error?}",
    permission:"L1_READ",dangerous:false,actions:["search playbooks and lessons","find skill","بحث عن مهارة","بحث في الدروس"],tags:["learning","skill","playbook","lesson","how-to","مهارة","درس"]});
  core.toolAdapters.register("learning.search",{async execute(request){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const query=typeof input.query==="string"?input.query:"";const error=typeof input.error==="string"?input.error:undefined;
    let stack:string|undefined;try{stack=detectProject(projectDir(request.projectId)).stack;}catch{}
    const playbooks=matchPlaybooks({goal:query,...(stack?{stack}:{}),projectId:request.projectId},3).map(p=>({id:p.id,title:p.title,source:p.source,body:p.body.slice(0,3000)}));
    const lessons=findLessons({goal:query,...(error?{error}:{}),...(stack?{stack}:{}),projectId:request.projectId},5).map(l=>({kind:l.kind,text:l.text}));
    return{playbooks,lessons,available:listPlaybooks(request.projectId).filter(p=>p.status==="active").map(p=>p.title)};
  }});
  core.tools.register({name:"learning.record",description:"remember a lesson for future work: payload {text, kind: fix|pitfall, trigger?} — e.g. the exact fix for an error you solved.",
    permission:"L3_MODIFY",dangerous:false,actions:["record lesson","تسجيل درس"],tags:["learning","lesson","memory","درس"]});
  core.toolAdapters.register("learning.record",{async execute(request){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const text=typeof input.text==="string"?input.text.trim():"";if(text.length<10)throw new Error("text is required.");
    let stack="unknown";try{stack=detectProject(projectDir(request.projectId)).stack;}catch{}
    const l=recordLesson({projectId:request.projectId??"default",stack,kind:input.kind==="pitfall"?"pitfall":"fix",trigger:typeof input.trigger==="string"?input.trigger:text,text});
    return{recorded:l.id};
  }});
}

/**
 * Specialised agents. Each sees only the tools of its job, so a small local model chooses
 * better and cannot wander into unrelated areas. The supervisor hands each milestone to one.
 */
export function specialisedAgents(base:AgentContract):AgentContract[]{
  const pick=(names:string[])=>base.allowedTools.filter(t=>names.some(n=>n.endsWith(".")?t.startsWith(n):t===n));
  const make=(agentId:string,purpose:string,tools:string[]):AgentContract=>({...base,agentId,purpose,allowedTools:pick(tools)});
  return[
    make("coder","Write and fix code inside the project, then verify it. Read project.knowledge and project.code_map first, run project.references before changing shared code, record decisions.",["files.","project.","development.prepare","terminal.exec","git.status","git.diff","git.log","git.checkpoint","git.branch","git.add","git.commit","git.rollback","browser.test","agent.external","memory.recall","mission.inspect","github.","http.read","browser.read","learning.","git.merge"]),
    make("tester","Run tests, builds, browser and security checks and report precisely what fails.",["project.run","project.verify","project.security","project.knowledge","project.references","project.knowledge.record","browser.test","files.read","files.list","files.stat","git.status","git.diff","terminal.exec","memory.recall","mission.inspect"]),
    make("researcher","Research on the internet (official documentation first) and write playbooks to .layanx/playbooks.",["research.internet","agent-reach.","browser.read","http.read","github.","files.write","files.read","memory.recall","learning.","project.knowledge"]),
    make("operator","Operate desktop applications with screenshots, mouse and keyboard.",["desktop.","files.read","files.list","browser.test","memory.recall"]),
    make("business","Run commerce, content, social, ads, email and growth work.",["commerce.","content.","campaign.create","media.","ads.","growth.","google.","yahoo.","email.invoices.scan","creator.","quran.","memory.recall","mission.inspect"])
  ];
}
