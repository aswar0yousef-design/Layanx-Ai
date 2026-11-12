import fs from "node:fs";
import path from "node:path";
import {failureSignature} from "./model-handoff.js";
import {NO_VISIBLE_EFFECT} from "./repair-engine.js";

/**
 * Evidence-first repair of a Node project: its own test command shows the failure, the stack frames lead to the code,
 * the model proposes one small patch, and the same command judges it. Tests may never be edited to make them pass.
 */
export const NODE_REPAIR_PROFILE="node-repair-v1";
const CODE_BUDGET=9000,TEST_BUDGET=3500,MAX_WALK=400;
const SKIP=new Set(["node_modules",".git",".layanx","dist","build","coverage",".next",".expo"]);
export const NODE_EDITABLE=/\.(?:[cm]?js|jsx|[cm]?ts|tsx)$/i;
const TEST_FILE=/(?:^|[\\/])(?:tests?|__tests__|specs?)[\\/]|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
export const isTestFile=(file:string)=>TEST_FILE.test(file);

export interface NodeTestObservation{ok:boolean;timedOut:boolean;failing:string[];summary:string;signature:string;raw:string}

export function hasRealTestScript(dir:string):boolean{
  try{const script=JSON.parse(fs.readFileSync(path.join(dir,"package.json"),"utf8"))?.scripts?.test;return typeof script==="string"&&script.trim()!==""&&!/no test specified/i.test(script);}
  catch{return false;}
}
export function needsDependencies(dir:string):boolean{
  try{const pkg=JSON.parse(fs.readFileSync(path.join(dir,"package.json"),"utf8"));return Object.keys({...pkg.dependencies,...pkg.devDependencies}).length>0&&!fs.existsSync(path.join(dir,"node_modules"));}
  catch{return false;}
}

/** Names of the failing tests, for the runners people actually use. Empty when the format is unknown. */
export function failingTestNames(output:string):string[]{
  const clean=output.replace(/\u001b\[[0-9;]*m/g,"");
  const names=new Set<string>();
  for(const pattern of [/^\s*not ok \d+ (?:- )?(.+?)(?:\s+#\s*(?:TODO|SKIP)\b.*)?$/gm,/^\s*[✖✕×]\s+(.+?)(?:\s+\(\d[\d.]*\s?m?s\))?\s*$/gm,/^\s*●\s+(.+)$/gm,/^\s*FAIL\s+\S+\s+>\s+(.+)$/gm,/^\s+\d+\)\s+(.+?):?\s*$/gm])
    for(const match of clean.matchAll(pattern)){
      const name=match[1]!.trim();
      if(name&&!/^(?:failing tests?:?|\d+ failing|Test Suites?:)/i.test(name))names.add(name);
    }
  return[...names].sort();
}
const NOISE=/^\s*(?:at\s|generatedMessage\b|code:|operator:|diff:|name:|stack:|\[cause\]|[{}\[\]],?\s*$|test at\s)/;
/** The runner's closing section pairs every failing test with its own actual and expected values. */
export function failureDetails(raw:string):string{
  const clean=raw.replace(/\u001b\[[0-9;]*m/g,""),at=clean.search(/^\s*\S*\s*failing tests:\s*$/m);
  if(at<0)return tapDetails(clean);
  return clean.slice(at).split(/\r?\n/).filter(line=>line.trim()&&!NOISE.test(line)).join("\n");
}
/** tape and other TAP runners: each "not ok" line, then a YAML block with operator, expected, actual and where. */
export function tapDetails(clean:string):string{
  const out:string[]=[];
  const lines=clean.split(/\r?\n/);
  for(let i=0;i<lines.length&&out.length<60;i++){
    if(!/^\s*not ok \d+/.test(lines[i]!))continue;
    out.push(lines[i]!.trim());
    for(let j=i+1;j<lines.length&&j<i+40;j++){
      const line=lines[j]!;
      if(/^\s*(?:\.\.\.|ok \d+|not ok \d+|#)/.test(line))break;
      if(/^\s*(?:operator|expected|actual|at):/.test(line))out.push("  "+line.trim().slice(0,400));
    }
  }
  return out.join("\n");
}
export function observeTestRun(run:{exitCode?:number|null;timedOut?:boolean;stdout?:string;stderr?:string;error?:string;ok?:boolean}):NodeTestObservation{
  const raw=[run.stdout,run.stderr,run.error].filter(Boolean).join("\n");
  const ok=run.exitCode===0&&!run.timedOut&&run.ok!==false;
  const failing=ok?[]:failingTestNames(raw);
  const errorLines=raw.split(/\r?\n/).filter(line=>/\b(?:Error|expected|actual|AssertionError|Cannot find|is not a function|is not defined|undefined)\b/.test(line)).slice(0,30).join("\n");
  const details=ok?"":failureDetails(raw);
  const summary=ok?"All of the project's tests pass.":[run.timedOut?"The test command did not finish in time.":"",details||(failing.length?"Failing tests:\n"+failing.slice(0,20).join("\n"):""),details?"":(errorLines||raw.slice(-1500))].filter(Boolean).join("\n").slice(0,2500);
  return{ok,timedOut:Boolean(run.timedOut),failing,summary,signature:ok?"":failureSignature(failing.length?failing.join("|")+"\n"+errorLines:raw),raw};
}

function walk(dir:string):string[]{
  const found:string[]=[];
  const visit=(folder:string)=>{
    if(found.length>=MAX_WALK)return;
    for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
      if(entry.isDirectory()){if(!SKIP.has(entry.name))visit(path.join(folder,entry.name));continue;}
      if(NODE_EDITABLE.test(entry.name))found.push(path.relative(dir,path.join(folder,entry.name)).replace(/\\/g,"/"));
    }
  };
  visit(dir);
  return found;
}
/** Project files named by stack frames, nearest to the failure first. */
export function framesInProject(dir:string,output:string):string[]{
  const root=path.resolve(dir),files:string[]=[];
  for(const match of output.matchAll(/(?:file:\/\/\/?)?((?:[A-Za-z]:[\\/]|\/|\.{0,2}[\\/]?)[^\s:()'"]+?\.[cm]?[jt]sx?):\d+(?::\d+)?/g)){
    const full=path.resolve(root,decodeURIComponent(match[1]!));
    if(!full.startsWith(root+path.sep)||full.includes(path.sep+"node_modules"+path.sep)||!fs.existsSync(full))continue;
    const relative=path.relative(root,full).replace(/\\/g,"/");
    if(!files.includes(relative))files.push(relative);
  }
  return files;
}
/** require('../') or require('./lib'): the folder's package.json "main", if there is one. */
function packageMain(dir:string,folder:string):string|undefined{
  try{
    const main=JSON.parse(fs.readFileSync(path.join(dir,folder,"package.json"),"utf8"))?.main;
    if(typeof main!=="string")return undefined;
    const target=path.posix.normalize(path.posix.join(folder,main));
    return [target,target+".js",target+"/index.js"].find(c=>fs.existsSync(path.join(dir,c))&&fs.statSync(path.join(dir,c)).isFile());
  }catch{return undefined;}
}
function importsOf(dir:string,file:string):string[]{
  const text=fs.readFileSync(path.join(dir,file),"utf8"),base=path.posix.dirname(file);
  const found:string[]=[];
  for(const match of text.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"](\.[^'"]+)['"]/g)){
    const target=path.posix.normalize(path.posix.join(base,match[1]!));
    // TypeScript sources are imported by their .js name, so the file on disk may only exist as .ts.
    for(const candidate of [target,target+".js",target+".mjs",target+".ts",target.replace(/\.js$/,".ts"),target.replace(/\.js$/,".tsx"),packageMain(dir,target),target+"/index.js"].filter((c):c is string=>Boolean(c)))
      if(fs.existsSync(path.join(dir,candidate))&&fs.statSync(path.join(dir,candidate)).isFile()){found.push(candidate);break;}
  }
  return found;
}
const COMMON=new Set(["this","that","with","when","from","should","return","function","const","true","false","null","undefined","test","tests","expected","actual","equal","operator","error","assert","value","values","options","string","object","array","there","which","have","what","does","into","only","after","before","because","change","smallest","report","project","code","bug","fix","the","and","for","not"]);
/** Words that point at the cause: identifiers and quoted strings from the report and the failure, not common words. */
export function evidenceTerms(...texts:string[]):string[]{
  const terms=new Set<string>();
  for(const text of texts){
    for(const m of text.matchAll(/[A-Za-z_$][\w$]{3,}/g)){const w=m[0];if(!COMMON.has(w.toLowerCase()))terms.add(w);}
    for(const m of text.matchAll(/%[0-9A-Fa-f]{2}/g))terms.add(m[0]); // percent escapes such as %2E name the code that handles them
  }
  return[...terms].slice(0,60);
}
/**
 * A file too large to show whole: the parts that matter, copied exactly (edits must quote the file), with their line
 * numbers. A part matters when it is a stack-frame line or uses words from the report and the failure.
 * Seen live 2026-11-12: lib/stringify.js of the qs library (13 KB) was skipped, and the model guessed src/stringify.js.
 */
export function fileExcerpt(text:string,terms:string[],frameLines:number[],budget:number,radius=12):string{
  const lines=text.split(/\r?\n/);
  const lower=terms.map(t=>t.toLowerCase());
  const score=lines.map((line,i)=>{const l=line.toLowerCase();return lower.filter(t=>l.includes(t)).length*2+(frameLines.includes(i+1)?10:0);});
  const ranked=score.map((v,i)=>[v,i] as const).filter(([v])=>v>0).sort((a,b)=>b[0]-a[0]||a[1]-b[1]);
  const keep=new Set<number>();let used=0;
  for(const[,i]of ranked){
    const from=Math.max(0,i-radius),to=Math.min(lines.length-1,i+radius);
    const added=lines.slice(from,to+1).filter((_,k)=>!keep.has(from+k)).reduce((n,l)=>n+l.length+1,0);
    if(used+added>budget)continue;
    for(let k=from;k<=to;k++)keep.add(k);used+=added;
  }
  if(!keep.size)return"";
  const out:string[]=[];let last=-2;
  for(const i of[...keep].sort((a,b)=>a-b)){if(i!==last+1)out.push(`... (line ${i+1})`);out.push(lines[i]!);last=i;}
  return out.join("\n");
}
const frameLinesOf=(raw:string,file:string)=>{
  const name=file.split("/").pop()!.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),found:number[]=[];
  for(const m of raw.matchAll(new RegExp(name+":(\\d+)","g")))found.push(Number(m[1]));
  return found;
};
/** Code the model must see, and the failing tests it may read but not change. */
export function repairEvidence(dir:string,observation:NodeTestObservation,report="",previous=""):{code:string;tests:string;files:string[]}{
  const all=walk(dir),frames=framesInProject(dir,observation.raw);
  const testFrames=frames.filter(isTestFile);
  const tests=testFrames.length?testFrames:all.filter(isTestFile).slice(0,6);
  const reached=new Set(frames.filter(file=>!isTestFile(file)));
  for(const test of tests)for(const target of importsOf(dir,test))if(!isTestFile(target))reached.add(target);
  // Two hops further: the bug is often in what the code under test calls (a package's index re-exports its modules).
  for(let hop=0;hop<2;hop++)for(const file of [...reached])for(const target of importsOf(dir,file))if(!isTestFile(target))reached.add(target);
  // A file the model named in its last attempt (often one it was not shown, seen live: lib/parse.js) is shown first.
  const named=[...new Set([...previous.matchAll(/([\w./-]+\.[cm]?[jt]sx?)/g)].map(m=>m[1]!.replace(/^\.\//,"")))].filter(file=>all.includes(file)&&!isTestFile(file));
  for(const file of named)reached.add(file);
  const terms=evidenceTerms(report,observation.summary,previous);
  // Most relevant first: a file whose name the report uses ("qs.parse"), that the stack names, or that uses the most of
  // the report's words. Import order put lib/utils.js first and left no room for lib/parse.js, where the bug was.
  const said=(report+"\n"+observation.summary).toLowerCase();
  const relevance=new Map([...reached].map(file=>{
    const text=fs.readFileSync(path.join(dir,file),"utf8").toLowerCase(),base=path.posix.basename(file).replace(/\.[^.]+$/,"").toLowerCase();
    const hits=terms.reduce((n,t)=>n+Math.min(5,text.split(t.toLowerCase()).length-1),0);
    return[file,hits+(base.length>2&&new RegExp("\\b"+base.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b").test(said)?25:0)+(frames.includes(file)?30:0)+(named.includes(file)?60:0)];
  }));
  const ordered=[...[...reached].sort((a,b)=>relevance.get(b)!-relevance.get(a)!),...all.filter(file=>!isTestFile(file)&&!reached.has(file))];
  let excerpts=0;
  let code="",room=CODE_BUDGET;const files:string[]=[];
  for(const file of ordered){
    const text=fs.readFileSync(path.join(dir,file),"utf8");
    if(text.length<=room){room-=text.length;files.push(file);code+=`--- ${file}\n${text}\n`;continue;}
    // Too large to show whole: only files the failure reaches get an excerpt, never unrelated ones.
    if(!reached.has(file)||room<800)continue;
    const part=fileExcerpt(text,terms,frameLinesOf(observation.raw,file),Math.min(room-200,excerpts++===0?4500:2500));
    if(!part)continue;
    room-=part.length+120;files.push(file);
    code+=`--- ${file} (EXCERPT of a ${text.split(/\r?\n/).length}-line file; "... (line N)" marks skipped lines; copy "find" text only from the lines shown)\n${part}\n`;
  }
  let testText="",testRoom=TEST_BUDGET;
  for(const file of tests){
    const text=fs.readFileSync(path.join(dir,file),"utf8"),at=frameLinesOf(observation.raw,file);
    // The failing test itself, not the start of a long file.
    const shown=at.length&&text.length>testRoom?fileExcerpt(text,[],at,testRoom,15):text.slice(0,testRoom);
    testRoom-=shown.length;testText+=`--- ${file}\n${shown}\n`;if(testRoom<=0)break;
  }
  return{code,tests:testText,files};
}

export function buildNodeRepairPrompt(dir:string,report:string,observation:NodeTestObservation,previous?:string):string{
  const evidence=repairEvidence(dir,observation,report,previous??"");
  return[
    "You fix one reported bug in an existing Node project with the smallest possible change. Return ONLY JSON:",
    '{"cause":"one sentence","edits":[{"path":"src/file.js","find":"exact text copied from the file","replace":"new text","line":0}]}',
    '"line" is optional: the line number where find starts, needed only when the same text appears more than once.',
    "Rules: at most 3 edits. Each find must be copied exactly from the code below and occur once in that file; include enough of the line to be unique.",
    "Fix the cause in the source code. Never edit a test or package.json, never skip or weaken a test, no empty try/catch, and do not special-case the values the tests use.",
    "Bug report: "+report,
    "What the project's own test command showed:\n"+observation.summary,
    "Source code:\n"+evidence.code,
    "The failing tests (read only):\n"+evidence.tests,
    previous?"Your previous attempt did not solve it:\n"+previous.slice(0,1500):""
  ].filter(Boolean).join("\n\n");
}

/** Why a patch must be undone: it broke a test that passed, or changed nothing. New failures among already failing work are progress. */
export function nodeRepairSetback(before:NodeTestObservation,after:NodeTestObservation):string|undefined{
  if(after.ok)return undefined;
  if(after.timedOut&&!before.timedOut)return"The patch made the test command hang.";
  if(before.failing.length&&after.failing.length){
    const broken=after.failing.filter(name=>!before.failing.includes(name));
    if(broken.length)return"The patch broke tests that passed: "+broken.slice(0,8).join("; ");
    if(after.failing.length<before.failing.length)return undefined;
  }
  if(after.signature===before.signature)return NO_VISIBLE_EFFECT+"\n"+after.summary;
  return undefined;
}

/**
 * Lines in the patched file that look like a line the patch changed but were left as they were. Seen live 2026-11-12 (qs):
 * the same bug was on two lines, one per charset; the test covered one, the model fixed one, every test passed, and the
 * fix was incomplete. These are shown to the model once more before the job may count as done.
 */
export function similarUnchanged(content:string,edits:Array<{path:string;find:string;replace:string}>,limit=5):Array<{path:string;line:number;text:string}>{
  const shape=(line:string)=>new Set(line.trim().match(/[A-Za-z_$][\w$]*|[^\s\w]/g)??[]);
  const similar=(a:Set<string>,b:Set<string>)=>{if(a.size<3||b.size<3)return false;let common=0;for(const x of a)if(b.has(x))common++;return common/(a.size+b.size-common)>=0.6;};
  const lines=content.split(/\r?\n/),found:Array<{path:string;line:number;text:string}>=[];
  for(const edit of edits){
    const replaced=new Set(edit.replace.split(/\r?\n/).map(l=>l.trim()));
    const changed=edit.find.split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!replaced.has(l));
    for(const before of changed){
      const target=shape(before);
      lines.forEach((line,i)=>{
        const t=line.trim();
        if(!t||replaced.has(t)||found.some(f=>f.line===i+1)||found.length>=limit)return;
        if(similar(target,shape(t)))found.push({path:edit.path,line:i+1,text:t.slice(0,200)});
      });
    }
  }
  return found;
}
export function siblingPrompt(cause:string,edits:Array<{path:string;find:string;replace:string}>,siblings:Array<{path:string;line:number;text:string}>,report:string):string{
  return["You just fixed a reported bug and the project's tests pass. Before it counts as done, check the lines below.",
    "Bug report: "+report.slice(0,800),"Your cause: "+cause.slice(0,300),
    "Your change:\n"+edits.map(e=>`--- ${e.path}\n- ${e.find.slice(0,400)}\n+ ${e.replace.slice(0,400)}`).join("\n"),
    "These lines in the same file look like the one you changed but were left as they were:\n"+siblings.map(s=>`${s.path}:${s.line}: ${s.text}`).join("\n"),
    "If any of them has the same bug, fix it the same way. If none does, return no edits. Return ONLY JSON:",
    '{"edits":[{"path":"file","find":"exact text from that line","replace":"new text"}]}  or  {"edits":[]}'
  ].join("\n\n");
}
