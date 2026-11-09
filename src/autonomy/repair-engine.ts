import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

/**
 * Evidence-first repair of an existing static web project. A small local model cannot explore a repository
 * through a long tool loop in time, so the system reproduces the bug in a real browser, collects the code the
 * failure points at, and asks the model for one small patch. The system applies and re-observes it.
 */
export const STATIC_REPAIR_PROFILE="static-repair-v1";
const MAX_PAGES=8,PROMPT_CODE_BUDGET=9000,MAX_EDIT_LINES=40;

export interface PageError{message:string;stack:string}
export interface PageObservation{page:string;target:boolean;errors:PageError[];consoleErrors:string[];missing:string[];text:string}
export interface StaticObservation{ok:boolean;pages:PageObservation[];summary:string;signature:string}
export type StaticObserver=(dir:string,report:string)=>Promise<StaticObservation>;
export interface RepairEdit{path:string;find:string;replace:string}
export interface PreparedRepair{cause:string;files:Array<{path:string;content:string;original:string}>;changedLines:number}

export function rootPages(dir:string):string[]{
  return fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&/\.html?$/i.test(e.name)).map(e=>e.name).sort().slice(0,MAX_PAGES);
}
export function isStaticWebProject(dir:string):boolean{
  return !fs.existsSync(path.join(dir,"package.json"))&&rootPages(dir).length>0;
}
export function reportedPages(report:string,pages:string[]):string[]{
  const named=pages.filter(page=>report.toLowerCase().includes(page.toLowerCase()));
  return named.length?named:pages;
}
export function expectedPhrases(report:string):string[]{
  return [...report.matchAll(/«([^»]{2,120})»/g)].map(match=>match[1]!.trim());
}

/** Combines per-page facts into one verdict. Only the reported pages must be clean: other pages may have older bugs. */
export function summarizeObservation(pages:PageObservation[]):StaticObservation{
  const problems=pages.filter(p=>p.target).flatMap(p=>[
    ...p.errors.map(e=>`${p.page}: uncaught error: ${e.message}`),
    ...p.consoleErrors.map(e=>`${p.page}: console error: ${e}`),
    ...p.missing.map(text=>`${p.page}: expected text is not shown: ${text}`)
  ]);
  return{ok:pages.some(p=>p.target)&&!problems.length,pages,summary:problems.join("\n").slice(0,2000)||"The reported pages load without errors and show the expected text.",signature:problems.join("|")};
}

/** A fresh browser profile is the "first visit" the owner reports; nothing is seeded. */
export const observeStaticProject:StaticObserver=async(dir,report)=>{
  const root=path.resolve(dir);
  const mime:Record<string,string>={".html":"text/html; charset=utf-8",".htm":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json"};
  const server=http.createServer((request,response)=>{
    const file=path.resolve(root,"."+decodeURIComponent(new URL(request.url??"/","http://local").pathname));
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){response.writeHead(404);response.end();return;}
    response.writeHead(200,{"content-type":mime[path.extname(file).toLowerCase()]??"application/octet-stream"});
    response.end(fs.readFileSync(file));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",()=>resolve()));
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/`;
  const pw:any=await import(process.env.LAYANX_PLAYWRIGHT_MODULE??"playwright-core");
  const chromium=pw.chromium??pw.default?.chromium;
  const browser=await chromium.launch({headless:true,channel:"msedge"}).catch(()=>chromium.launch({headless:true,channel:"chrome"}));
  try{
    const pages=rootPages(root);
    const targets=new Set(reportedPages(report,pages));
    const phrases=expectedPhrases(report);
    const observed:PageObservation[]=[];
    for(const name of pages){
      const context=await browser.newContext();
      const page=await context.newPage();
      const errors:PageError[]=[],consoleErrors:string[]=[];
      page.on("pageerror",(e:Error)=>errors.push({message:e.message,stack:e.stack??""}));
      page.on("console",(m:any)=>{if(m.type()==="error"&&!/Failed to load resource/i.test(m.text()))consoleErrors.push(m.text().slice(0,300));});
      await page.goto(base+encodeURIComponent(name),{waitUntil:"load",timeout:20000});
      await page.waitForTimeout(500);
      const text=String(await page.locator("body").innerText().catch(()=>""));
      observed.push({page:name,target:targets.has(name),errors,consoleErrors,missing:targets.has(name)?phrases.filter(p=>!text.includes(p)):[],text:text.slice(0,600)});
      await context.close();
    }
    return summarizeObservation(observed);
  }finally{
    await browser.close().catch(()=>undefined);
    await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
};

interface SourceBlock{file:string;name:string;text:string}
const TOP_LEVEL=/^(?:async\s+)?function\s+([\w$]+)|^(?:const|let|var)\s+([\w$]+)|^(?:document|window)\b/;
/** Splits a script at its top-level declarations; good enough to show a model whole functions. */
export function sourceBlocks(file:string,source:string):SourceBlock[]{
  const blocks:SourceBlock[]=[];let current:SourceBlock|undefined;
  for(const line of source.split(/\r?\n/)){
    const match=TOP_LEVEL.exec(line);
    if(match){current={file,name:match[1]??match[2]??"",text:""};blocks.push(current);}
    if(current)current.text+=line+"\n";
  }
  return blocks;
}
function localScripts(dir:string,pages:string[]):string[]{
  const found=new Set<string>();
  for(const page of pages){
    const html=fs.readFileSync(path.join(dir,page),"utf8");
    for(const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)){
      const src=match[1]!;
      if(!/^[a-z]+:|^\/\//i.test(src)&&fs.existsSync(path.join(dir,src)))found.add(src.replace(/^\.?\//,""));
    }
  }
  return[...found];
}
/** The names a failure and the report point at: undefined identifiers, stack frames, element ids and quoted code. */
export function evidenceTokens(report:string,observation:StaticObservation):string[]{
  const tokens=new Set<string>();
  for(const page of observation.pages.filter(p=>p.target)){
    for(const error of page.errors){
      for(const match of error.message.matchAll(/([A-Za-z_$][\w$]*) is not defined|reading '([\w$]+)'|([A-Za-z_$][\w$.]*) is not a function/g))tokens.add((match[1]??match[2]??match[3]!).split(".").pop()!);
      for(const match of error.stack.matchAll(/at (?:[\w$.]*\.)?([A-Za-z_$][\w$]*) \(/g))tokens.add(match[1]!);
    }
  }
  for(const match of report.matchAll(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b|\b[a-z]+[A-Z][A-Za-z0-9]*\b/g))tokens.add(match[0]);
  return[...tokens].filter(token=>!/^(?:Object|HTMLDocument|EventTarget)$/.test(token));
}

export function buildRepairPrompt(dir:string,report:string,observation:StaticObservation,previous?:string):string{
  const targets=observation.pages.filter(p=>p.target).map(p=>p.page);
  const scripts=localScripts(dir,targets);
  const blocks=scripts.flatMap(file=>sourceBlocks(file,fs.readFileSync(path.join(dir,file),"utf8")));
  const tokens=evidenceTokens(report,observation);
  const relevant=new Set(blocks.filter(block=>tokens.some(token=>block.name===token||block.text.includes(token))));
  // Two hops of callers: "why did this run or not run" usually lives in the caller.
  for(let hop=0;hop<2;hop++){
    const names=[...relevant].map(block=>block.name).filter(Boolean);
    for(const block of blocks)if(names.some(name=>new RegExp("\\b"+name.replace(/\$/g,"\\$")+"\\s*\\(").test(block.text)))relevant.add(block);
  }
  let code="",room=PROMPT_CODE_BUDGET;
  for(const block of blocks.filter(block=>relevant.has(block))){
    if(block.text.length>room)continue;
    room-=block.text.length;code+=`--- ${block.file}\n${block.text}`;
  }
  const allFiles=fs.readdirSync(dir).filter(name=>/\.js$/i.test(name));
  const undefinedNames=observation.pages.flatMap(p=>p.errors).flatMap(e=>[...e.message.matchAll(/([A-Za-z_$][\w$]*) is not defined/g)].map(m=>m[1]!));
  const whereDefined=[...new Set(undefinedNames)].flatMap(name=>allFiles.flatMap(file=>fs.readFileSync(path.join(dir,file),"utf8").split(/\r?\n/).flatMap((line,i)=>line.includes(name)?[`${file}:${i+1}: ${line.trim().slice(0,160)}`]:[]))).slice(0,10);
  const pageMarkup=targets.slice(0,2).map(page=>`--- ${page}\n${fs.readFileSync(path.join(dir,page),"utf8").slice(0,2500)}`).join("\n");
  return[
    "You fix one reported bug in an existing web project with the smallest possible change. Return ONLY JSON:",
    '{"cause":"one sentence","edits":[{"path":"app.js","find":"exact text copied from the file","replace":"new text"}]}',
    "Rules: at most 3 edits. Each find must be copied exactly from the code below and occur once in that file; include enough of the line to be unique.",
    "Fix the cause, do not hide it: no empty try/catch and no removing the feature. Do not rewrite files, rename things or reformat. Never call a function that is not defined anywhere. Never put the expected text anywhere it was not meant to be just to satisfy the report.",
    "Bug report: "+report,
    "What a real browser observed on a first visit:\n"+observation.summary,
    "Text visible on the reported page: "+(observation.pages.find(p=>p.target)?.text||"(nothing)"),
    whereDefined.length?"Every place the undefined names occur in the project:\n"+whereDefined.join("\n"):"",
    "Page markup:\n"+pageMarkup,
    "Relevant code:\n"+code,
    "Functions defined in these scripts: "+blocks.map(block=>block.name).filter(Boolean).join(", "),
    previous?"Your previous attempt did not solve it:\n"+previous.slice(0,1500):""
  ].filter(Boolean).join("\n\n");
}

const lineCount=(text:string)=>text.split("\n").length;
/** Validates a proposed patch against the files on disk without writing anything. Throws the reason it is unusable. */
export function prepareRepair(dir:string,proposal:unknown):PreparedRepair{
  const value=proposal as {cause?:unknown;edits?:unknown}|null;
  if(!value||!Array.isArray(value.edits)||!value.edits.length)throw new Error("The model returned no edits.");
  if(value.edits.length>3)throw new Error("More than 3 edits were proposed.");
  const root=path.resolve(dir);
  const files=new Map<string,{content:string;original:string}>();
  let changedLines=0;
  for(const raw of value.edits as RepairEdit[]){
    if(typeof raw?.path!=="string"||typeof raw.find!=="string"||typeof raw.replace!=="string"||!raw.find)throw new Error("An edit is missing path, find or replace.");
    if(raw.find===raw.replace)throw new Error("An edit changes nothing.");
    const relative=raw.path.replace(/^\.?[\\/]/,"");
    const full=path.resolve(root,relative);
    if(!full.startsWith(root+path.sep)||relative.startsWith(".layanx")||!/\.(?:js|html?|css)$/i.test(relative))throw new Error("Edit target is not allowed: "+raw.path);
    if(!fs.existsSync(full))throw new Error("Edit target does not exist: "+raw.path);
    const current=files.get(relative)??{content:fs.readFileSync(full,"utf8"),original:fs.readFileSync(full,"utf8")};
    const eol=current.content.includes("\r\n")?"\r\n":"\n";
    const find=raw.find.replace(/\r?\n/g,eol),replace=raw.replace.replace(/\r?\n/g,eol);
    const occurrences=current.content.split(find).length-1;
    if(occurrences!==1)throw new Error(`find must occur exactly once in ${relative}; it occurs ${occurrences} times: ${raw.find.slice(0,120)}`);
    changedLines+=lineCount(raw.find)+lineCount(raw.replace);
    current.content=current.content.replace(find,()=>replace);
    files.set(relative,current);
  }
  if(changedLines>MAX_EDIT_LINES)throw new Error(`The patch changes ${changedLines} lines; the limit is ${MAX_EDIT_LINES}.`);
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"lx-repair-"));
  try{
    for(const[relative,file]of files){
      if(!/\.js$/i.test(relative))continue;
      const candidate=path.join(temp,"candidate.js");
      fs.writeFileSync(candidate,file.content);
      const check=spawnSync(process.execPath,["--check",candidate],{encoding:"utf8",timeout:8000,windowsHide:true});
      if(check.status!==0)throw new Error(`The patch breaks ${relative}: ${String(check.stderr).split("\n").find(l=>/Error/.test(l))??"syntax error"}`);
    }
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
  return{cause:typeof value.cause==="string"?value.cause.slice(0,400):"",files:[...files].map(([p,f])=>({path:p,content:f.content,original:f.original})),changedLines};
}

/**
 * Why a patch must be undone: it changed nothing observable, or another page that was clean now fails.
 * A new error on the reported page is progress: a correct fix often exposes the next cause behind it.
 */
export function repairSetback(before:StaticObservation,after:StaticObservation):string|undefined{
  const newlyBroken=after.pages.filter(page=>{
    const earlier=before.pages.find(p=>p.page===page.page);
    return !page.target&&Boolean(earlier)&&page.errors.length>0&&!earlier!.errors.length;
  }).map(page=>page.page+": "+page.errors[0]!.message);
  if(newlyBroken.length)return"The patch broke a page that worked: "+newlyBroken.join("; ");
  if(!after.ok&&after.signature===before.signature)return"The patch did not change what the browser observes:\n"+after.summary;
  return undefined;
}
