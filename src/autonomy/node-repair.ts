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
  for(const pattern of [/^\s*not ok \d+ - (.+)$/gm,/^\s*[✖✕×]\s+(.+?)(?:\s+\(\d[\d.]*\s?m?s\))?\s*$/gm,/^\s*●\s+(.+)$/gm,/^\s*FAIL\s+\S+\s+>\s+(.+)$/gm,/^\s+\d+\)\s+(.+?):?\s*$/gm])
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
  if(at<0)return"";
  return clean.slice(at).split(/\r?\n/).filter(line=>line.trim()&&!NOISE.test(line)).join("\n");
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
function importsOf(dir:string,file:string):string[]{
  const text=fs.readFileSync(path.join(dir,file),"utf8"),base=path.posix.dirname(file);
  const found:string[]=[];
  for(const match of text.matchAll(/(?:from\s+|require\(\s*|import\(\s*)['"](\.[^'"]+)['"]/g)){
    const target=path.posix.normalize(path.posix.join(base,match[1]!));
    // TypeScript sources are imported by their .js name, so the file on disk may only exist as .ts.
    for(const candidate of [target,target+".js",target+".mjs",target+".ts",target.replace(/\.js$/,".ts"),target.replace(/\.js$/,".tsx"),target+"/index.js"])
      if(fs.existsSync(path.join(dir,candidate))&&fs.statSync(path.join(dir,candidate)).isFile()){found.push(candidate);break;}
  }
  return found;
}
/** Code the model must see, and the failing tests it may read but not change. */
export function repairEvidence(dir:string,observation:NodeTestObservation):{code:string;tests:string;files:string[]}{
  const all=walk(dir),frames=framesInProject(dir,observation.raw);
  const testFrames=frames.filter(isTestFile);
  const tests=testFrames.length?testFrames:all.filter(isTestFile).slice(0,6);
  const reached=new Set(frames.filter(file=>!isTestFile(file)));
  for(const test of tests)for(const target of importsOf(dir,test))if(!isTestFile(target))reached.add(target);
  // One hop further: the bug is often in what the code under test calls.
  for(const file of [...reached])for(const target of importsOf(dir,file))if(!isTestFile(target))reached.add(target);
  const ordered=[...reached,...all.filter(file=>!isTestFile(file)&&!reached.has(file))];
  let code="",room=CODE_BUDGET;const files:string[]=[];
  for(const file of ordered){
    const text=fs.readFileSync(path.join(dir,file),"utf8");
    if(text.length>room)continue;
    room-=text.length;files.push(file);code+=`--- ${file}\n${text}\n`;
  }
  let testText="",testRoom=TEST_BUDGET;
  for(const file of tests){const text=fs.readFileSync(path.join(dir,file),"utf8").slice(0,testRoom);testRoom-=text.length;testText+=`--- ${file}\n${text}\n`;if(testRoom<=0)break;}
  return{code,tests:testText,files};
}

export function buildNodeRepairPrompt(dir:string,report:string,observation:NodeTestObservation,previous?:string):string{
  const evidence=repairEvidence(dir,observation);
  return[
    "You fix one reported bug in an existing Node project with the smallest possible change. Return ONLY JSON:",
    '{"cause":"one sentence","edits":[{"path":"src/file.js","find":"exact text copied from the file","replace":"new text"}]}',
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
