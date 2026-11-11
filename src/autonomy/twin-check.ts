/**
 * Differential testing. A reviewer that reads the code is only as sharp as the model behind it; on a small GPU the only strong
 * model is the one that wrote the program, and it tends to approve its own mistakes (measured 2026-11-10: planted bugs fixed
 * 3 of 9). So a second program is written for the same request without seeing the first, and both are run on many inputs.
 * Where they disagree, one of them is wrong. A case is locked only when a blind reading of the request, which sees neither
 * program, gives the same result as the twin and not the main program. Running real code finds what reading misses.
 */
import type {ReviewCase} from "./peer-review.js";

export const TWIN_PROGRAM_FILE=".layanx/twin/program.mjs";
export const TWIN_MARKER="LAYANX_TWIN ";
const MAX_INPUTS=24,MAX_CASES=3;
export interface TwinInput{args:string[];stdin:string}
export interface TwinRun extends TwinInput{main:{code:number;stdout:string;stderr?:string};twin:{code:number;stdout:string;stderr?:string}}

export const TWIN_INPUTS_SCHEMA={type:"object",properties:{inputs:{type:"array",items:{type:"object",properties:{args:{type:"array",items:{type:"string"}},stdin:{type:"string"}},required:["args","stdin"]}}},required:["inputs"]};

export function twinPrompt(goal:string,failure?:string):string{
  return[
    "Write the complete command-line Node.js program for this request. Return only the JavaScript file, no explanation.",
    "The request from the owner:\n"+goal,
    "It is an ES module run as `node program.mjs <args>`, uses only Node built-ins, reads standard input only when the request needs it, prints the result to stdout and sets process.exitCode (never import exitCode) instead of throwing for bad input.",
    "Follow the request exactly, including every edge case it mentions. Prefer a plain, careful approach: handle the input character by character or step by step rather than with clever shortcuts.",
    ...(failure?["An earlier version of this program failed to run on ordinary inputs. Avoid the same mistake:\n"+failure.slice(0,600)]:[])
  ].join("\n\n");
}
export function twinInputsPrompt(goal:string,tests:string):string{
  return[
    "A command-line program must follow the request below. List inputs that test it thoroughly. Return ONLY JSON:",
    '{"inputs":[{"args":["arg1"],"stdin":""}]}',
    `Give ${MAX_INPUTS-8} to ${MAX_INPUTS} short inputs: ordinary ones, every edge case the request mentions, and tricky ones near its rules (empty, whitespace, unusual characters, boundaries). args are the command-line arguments and stdin is standard input; use "" and [] when not needed. Do not give the outputs.`,
    "The request:\n"+goal,
    "Inputs the existing tests already use (do not repeat them):\n"+tests.slice(0,2500)
  ].join("\n\n");
}
export function parseTwinInputs(raw:unknown):TwinInput[]{
  const items=(raw as {inputs?:unknown}|null)?.inputs;
  if(!Array.isArray(items))throw new Error("Unusable output: invalid JSON, no inputs array.");
  const seen=new Set<string>(),clean:TwinInput[]=[];
  for(const item of items as Array<{args?:unknown;stdin?:unknown}>){
    const args=Array.isArray(item?.args)?item.args.map(String).slice(0,8):[],stdin=typeof item?.stdin==="string"?item.stdin.slice(0,2000):"";
    const key=JSON.stringify([args,stdin]);
    if(seen.has(key))continue;
    seen.add(key);clean.push({args,stdin});
    if(clean.length>=MAX_INPUTS)break;
  }
  return clean;
}
/** A test file that only runs both programs and prints what each gave; it always passes, so it can run through the normal test task. */
export function twinHarnessSource(inputs:TwinInput[],mainFile:string):string{
  return[
    "import test from 'node:test';",
    "import {spawnSync} from 'node:child_process';",
    "import path from 'node:path';",
    "import {fileURLToPath} from 'node:url';",
    "const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'..');",
    "const inputs="+JSON.stringify(inputs)+";",
    "const run=(file,i)=>{const r=spawnSync(process.execPath,[path.join(root,file),...i.args],{input:i.stdin,encoding:'utf8',timeout:5000,windowsHide:true,maxBuffer:1024*1024});return{code:typeof r.status==='number'?r.status:-1,stdout:String(r.stdout??'').slice(0,400),stderr:String(r.stderr??'').slice(0,300)};};",
    `test('twin comparison',()=>{const out=inputs.map(i=>({...i,main:run(${JSON.stringify(mainFile)},i),twin:run(${JSON.stringify(TWIN_PROGRAM_FILE)},i)}));console.log(${JSON.stringify(TWIN_MARKER)}+JSON.stringify(out));});`,
    ""
  ].join("\n");
}
export function parseTwinRun(output:string):TwinRun[]{
  const line=output.split(/\r?\n/).find(text=>text.includes(TWIN_MARKER));
  if(!line)throw new Error("The comparison did not report its results.");
  const runs=JSON.parse(line.slice(line.indexOf(TWIN_MARKER)+TWIN_MARKER.length)) as TwinRun[];
  if(!Array.isArray(runs))throw new Error("The comparison results are not a list.");
  return runs;
}
const normal=(text:string)=>{const trimmed=text.trim();try{return JSON.stringify(JSON.parse(trimmed));}catch{return trimmed.replace(/\r\n/g,"\n");}};
/** Two programs agree when both fail, or both succeed with the same output. A failure's wording is not part of the contract. */
export function disagree(run:TwinRun):boolean{
  if((run.main.code===0)!==(run.twin.code===0))return true;
  return run.main.code===0&&normal(run.main.stdout)!==normal(run.twin.stdout);
}
/** The twin's answer for each disagreement, as a candidate case; a blind reading still has to confirm it before it is locked. */
/** A twin that crashes or times out on most inputs is broken, and its disagreements say nothing about the main program. */
export function twinBroken(runs:TwinRun[]):boolean{
  return runs.filter(run=>run.twin.code!==0&&run.main.code===0).length>runs.length/2;
}
/** What the broken twin printed on failure, so a rewrite can avoid the same mistake. */
export function twinFailure(runs:TwinRun[]):string{
  const failed=runs.find(run=>run.twin.code!==0&&run.main.code===0);
  return failed?`input ${JSON.stringify({args:failed.args,stdin:failed.stdin.slice(0,80)})}: exit ${failed.twin.code}${failed.twin.stderr?", stderr: "+failed.twin.stderr:""}`:"";
}
export function twinCases(runs:TwinRun[],limit=MAX_CASES):ReviewCase[]{
  if(twinBroken(runs))return[];
  return runs.filter(run=>disagree(run)&&run.twin.code!==-1).slice(0,limit).map(run=>({
    args:run.args,stdin:run.stdin,code:run.twin.code===0?0:1,stdout:run.twin.code===0?run.twin.stdout.trim():"",
    why:`a separately written program gives ${run.twin.code===0?JSON.stringify(run.twin.stdout.trim().slice(0,60)):"a failure"} where this one gives ${run.main.code===0?JSON.stringify(run.main.stdout.trim().slice(0,60)):"a failure"}`
  }));
}
