import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {createBrowserTestAdapter} from "./browser-test.js";
import type {NodeTestObservation} from "./node-repair.js";
import {observeStaticProject,serveStatic,type StaticObservation} from "./repair-engine.js";

/**
 * Building a new project of a kind other than the fixed task app. The acceptance checks are written first, from the
 * owner's words, and locked; the code is then written against them and repaired with small patches. A model can no
 * longer pass by changing what "passing" means, and a runtime error costs one patch instead of a rewritten file.
 */
export const NODE_TOOL_PROFILE="node-tool-v1";
export const STATIC_SITE_PROFILE="static-site-v1";
export type BuildProfile=typeof NODE_TOOL_PROFILE|typeof STATIC_SITE_PROFILE;
export const isBuildProfile=(profile:unknown):profile is BuildProfile=>profile===NODE_TOOL_PROFILE||profile===STATIC_SITE_PROFILE;

export const PROGRAM_FILE="src/index.mjs",SPEC_TEST_FILE="tests/spec.test.mjs",HELPER_FILE="tests/helpers.mjs";
export const SITE_FILE="index.html",SITE_SPEC_FILE="acceptance/steps.json";
export const MIN_SPEC_CASES=4,MAX_SPEC_CASES=8;
const MIN_TESTS=MIN_SPEC_CASES,MIN_OUTPUT_CASES=2,MAX_STEPS=16,MIN_STEPS=2,SITE_PROMPT_BUDGET=14000;

export const PROGRAM_PLACEHOLDER="// Placeholder: the acceptance tests must fail against this.\nprocess.exit(1);\n";
export const SITE_PLACEHOLDER="<!doctype html><html><head><meta charset=utf-8><title>placeholder</title></head><body></body></html>\n";
const CLI_HELPER=`import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const program=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','src','index.mjs');
/** Runs the program the way a person would: arguments, standard input, exit code and output. */
export function cli(args=[],stdin=''){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[program,...args.map(String)],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let stdout='',stderr='';
    child.stdout.setEncoding('utf8').on('data',chunk=>{stdout+=chunk;});
    child.stderr.setEncoding('utf8').on('data',chunk=>{stderr+=chunk;});
    const timer=setTimeout(()=>child.kill(),10000);
    child.on('error',reject);
    child.on('close',code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
    child.stdin.on('error',()=>{});
    child.stdin.end(stdin);
  });
}
`;

/** A program that already has locked tests goes straight to review; nothing it has passed is redone. */
export function hasBuiltProgram(dir:string):boolean{
  try{return fs.existsSync(path.join(dir,SPEC_TEST_FILE))&&fs.readFileSync(path.join(dir,PROGRAM_FILE),"utf8")!==PROGRAM_PLACEHOLDER;}catch{return false;}
}
const REVIEW_STAGE=(goal:string)=>({title:"Independent review by another model",goal,kind:"code",stage:"review"});
export function buildPlan(profile:BuildProfile,goal:string,dir:string){
  const site=profile===STATIC_SITE_PROFILE;
  const empty={install:false,test:false,build:false,typecheck:false,lint:false,security:false,browser:null};
  if(!site&&hasBuiltProgram(dir))return{acceptance:["The locked tests pass","Objections two models agree on are fixed"],milestones:[REVIEW_STAGE(goal)],checks:empty};
  return{
    acceptance:site?["Every step written from the request passes in a real browser","The page loads without errors"]:["Every test written from the request passes","The tests fail against an empty program, so they check something real"],
    milestones:[
      {title:"Write the acceptance checks from the request",goal,kind:"test",stage:"spec"},
      {title:site?"Build the page and repair it until the checks pass":"Build the program and repair it until the tests pass",goal,kind:"code",stage:"code"},
      ...(site?[]:[REVIEW_STAGE(goal)])
    ],
    checks:empty
  };
}

const onlyCode=(text:string)=>{
  const fenced=[...text.matchAll(/```[\w-]*\r?\n([\s\S]*?)```/g)].map(match=>match[1]!).sort((a,b)=>b.length-a.length)[0];
  return(fenced??text).trim();
};
export function extractProgram(text:string):string{
  const code=onlyCode(text);
  if(code.length<20)throw new Error("Unusable output: empty response instead of a program.");
  return code+"\n";
}
export function extractHtml(text:string):string{
  const match=/<!doctype html[\s\S]*<\/html>|<html[\s\S]*<\/html>/i.exec(onlyCode(text));
  if(!match)throw new Error("Unusable output: empty response or a page cut off before </html>.");
  return match[0]+"\n";
}

// ---------------------------------------------------------------- a command-line program
export function nodeSpecPrompt(goal:string,previous?:string):string{
  return[
    "Write the acceptance cases for a command-line Node.js program BEFORE it exists. Return ONLY JSON:",
    '{"cases":[{"args":["2","3"],"stdin":"","code":0,"stdout":"5","why":"adds two numbers"}]}',
    `Write ${MIN_TESTS+1} to ${MAX_SPEC_CASES} cases that follow the request exactly and include edge cases it mentions. args and stdin are what the program receives, code is the exit code, stdout is its exact output ("" when it must fail). Keep inputs short so the expected output can be worked out exactly: count characters one by one.`,
    "The request from the owner:\n"+goal,
    previous?"Your previous cases were refused:\n"+previous.slice(0,1500):""
  ].filter(Boolean).join("\n\n");
}
export function nodeSpecFiles(goal:string,tests:string):Array<{path:string;content:string}>{
  const slug=(goal.toLowerCase().match(/[a-z0-9]+/g)??[]).slice(0,3).join("-")||"tool";
  return[
    {path:"package.json",content:JSON.stringify({name:slug,version:"1.0.0",private:true,type:"module",bin:{[slug]:PROGRAM_FILE},scripts:{test:"node --test",start:"node "+PROGRAM_FILE}},null,2)+"\n"},
    {path:HELPER_FILE,content:CLI_HELPER},
    {path:SPEC_TEST_FILE,content:tests},
    {path:PROGRAM_FILE,content:PROGRAM_PLACEHOLDER}
  ];
}
export function testCounts(output:string):{tests:number;pass:number;fail:number}{
  const counts={tests:0,pass:0,fail:0};
  for(const match of output.replace(/\u001b\[[0-9;]*m/g,"").matchAll(/^\s*(?:#|ℹ)\s*(tests|pass|fail)\s+(\d+)\s*$/gm))counts[match[1] as keyof typeof counts]=Number(match[2]);
  return counts;
}
/**
 * Why tests cannot be trusted. The empty program exits with 1, so a case that expects a refusal passes against it, and
 * rightly: it fails against a program that accepts everything. What must not happen is a suite that a program which
 * refuses everything would pass, so enough cases have to expect real output.
 */
export function vacuousTests(observation:NodeTestObservation):string|undefined{
  const counts=testCounts(observation.raw);
  if(observation.ok)return"The tests pass with no program at all, so they prove nothing.";
  if(counts.tests<MIN_TESTS)return`The tests did not run properly (${counts.tests} ran).\n${observation.summary}`;
  if(counts.fail<MIN_OUTPUT_CASES||counts.fail*3<counts.tests)return`Only ${counts.fail} of ${counts.tests} tests need real output; a program that refuses everything would nearly pass. Add cases with valid input and exact expected output.`;
  return undefined;
}
export function programPrompt(goal:string,dir:string,previous?:string):string{
  return[
    "Write the complete command-line Node.js program. Return only the JavaScript file, no explanation.",
    "The request from the owner:\n"+goal,
    "It is the ES module src/index.mjs, runs with `node src/index.mjs <args>`, uses only Node built-ins, reads standard input only when the request needs it, prints the result to stdout and sets process.exitCode instead of throwing for bad input. Write process.exitCode = n; never import exitCode from node:process, because an imported binding cannot be assigned and the program then crashes with exit code 1.",
    "These locked tests must pass; do not special-case their values:\n"+fs.readFileSync(path.join(dir,SPEC_TEST_FILE),"utf8").slice(0,5000),
    previous?"The current version failed. For each failing test, compare its input, actual and expected value, and correct every cause:\n"+previous.slice(0,2400):"",
    hasBuiltProgram(dir)?"The current version, to correct and return whole:\n"+fs.readFileSync(path.join(dir,PROGRAM_FILE),"utf8").slice(0,6000):""
  ].filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------- a static page
export interface SiteStep{action:"fill"|"click"|"press"|"expectText"|"expectValue"|"expectCount"|"reload";selector?:string;value?:string;text?:string;key?:string}
export function siteSpecPrompt(goal:string,previous?:string):string{
  return[
    "Write the acceptance steps for a single web page BEFORE it exists. Return ONLY JSON:",
    '{"steps":[{"action":"fill","selector":"#amount","value":"200"},{"action":"click","selector":"#calculate"},{"action":"expectText","text":"230"}]}',
    "Actions: fill (selector, value), click (selector), press (key), expectText (text that must be visible), expectValue (selector, value), expectCount (selector, value), reload (load the page again, for anything that must be saved).",
    "Every selector is a simple #id that you choose in English; the page will be built to match them. If the request names a button's label or a phrase, also expect that exact text.",
    `Use ${MIN_STEPS} to ${MAX_STEPS} steps that exercise what the request asks for, end to end, and at least one expectText. Choose inputs where different readings give different results (for a percentage of an amount, do not use 100). Work out expected values carefully; a page that only displays text needs only expectText steps.`,
    "The request from the owner:\n"+goal,
    previous?"Your previous steps were refused:\n"+previous.slice(0,1500):""
  ].filter(Boolean).join("\n\n");
}
export function parseSiteSteps(raw:unknown):SiteStep[]{
  const steps=(raw as {steps?:unknown}|null)?.steps;
  if(!Array.isArray(steps))throw new Error("Unusable output: invalid JSON, no steps array.");
  const problems:string[]=[];
  if(steps.length<MIN_STEPS||steps.length>MAX_STEPS)problems.push(`Use ${MIN_STEPS} to ${MAX_STEPS} steps; found ${steps.length}.`);
  const clean:SiteStep[]=[];
  for(const item of steps as SiteStep[]){
    if(!["fill","click","press","expectText","expectValue","expectCount","reload"].includes(item?.action)){problems.push("Unknown action: "+String(item?.action));continue;}
    if(["fill","click","expectValue","expectCount"].includes(item.action)&&!/^#[A-Za-z][\w-]*$/.test(String(item.selector??"")))problems.push(`${item.action} needs a simple #id selector.`);
    if(item.action==="expectText"&&!String(item.text??"").trim())problems.push("expectText needs text.");
    clean.push({action:item.action,...(item.selector?{selector:String(item.selector)}:{}),...(item.value!==undefined?{value:String(item.value)}:{}),...(item.text!==undefined?{text:String(item.text)}:{}),...(item.key?{key:String(item.key)}:{})});
  }
  if(!clean.some(step=>step.action==="expectText"||step.action==="expectValue"||step.action==="expectCount"))problems.push("No step checks a result.");
  if(problems.length)throw new Error("Steps refused: "+problems.join(" "));
  return clean;
}
export function siteSpecFiles(steps:SiteStep[]):Array<{path:string;content:string}>{
  return[{path:SITE_SPEC_FILE,content:JSON.stringify({steps},null,2)+"\n"},{path:SITE_FILE,content:SITE_PLACEHOLDER}];
}
/**
 * Every visible result is worked out again blind. Numbers are where a model miscalculates; text is where it forgets the state:
 * measured 2026-11-11, steps clicked "book" again with the name still filled in and expected "name required", which no correct
 * page can show, and a correct page was failed for it.
 */
// Text shown before anything is clicked is copied from the request; asking for it again only invites a different summary.
const interacted=(steps:SiteStep[],index:number)=>steps.slice(0,index).some(step=>step.action==="click"||step.action==="press");
const computedSteps=(steps:SiteStep[])=>steps.flatMap((step,index)=>{
  const text=step.action==="expectText"?step.text??"":step.action==="expectValue"?step.value??"":"";
  return /\d/.test(text)||(step.action==="expectText"&&interacted(steps,index))?[index]:[];
});
export const hasComputedSteps=(steps:SiteStep[])=>computedSteps(steps).length>0;
export function siteSecondOpinionPrompt(goal:string,steps:SiteStep[]):string{
  const hidden=steps.map((step,index)=>computedSteps(steps).includes(index)?{action:step.action,selector:step.selector,result:"?"}:step);
  return[
    "A web page must follow this request. Someone uses it as described below. Work out each result marked \"?\" yourself. Return ONLY JSON:",
    '{"results":["the number or exact text that must appear for the first ?","for the second ?"]}',
    "Steps run in order on the same page, and fields keep what was typed into them until changed. For text, give the exact words the page shows, as the request states them.",
    "The request:\n"+goal,
    "What the person does:\n"+JSON.stringify(hidden)
  ].join("\n\n");
}
/** Why the written steps cannot be locked: another reading of the request gives a different number. */
export function siteStepConflicts(steps:SiteStep[],raw:unknown):string[]{
  const results=(raw as {results?:unknown}|null)?.results;
  if(!Array.isArray(results))throw new Error("Unusable output: invalid JSON, no results array.");
  const numbers=(text:string)=>(text.match(/\d+(?:\.\d+)?/g)??[]).map(Number);
  const plain=(text:string)=>text.replace(/[«»"'“”.!،,:؛]/g," ").replace(/\s+/g," ").trim().toLowerCase();
  const agrees=(wrote:string,other:string)=>numbers(wrote).length?numbers(wrote).some(n=>numbers(other).includes(n)):!plain(other)||plain(other).includes(plain(wrote))||plain(wrote).includes(plain(other)); // an empty answer is no opinion, not a different result
  return computedSteps(steps).flatMap((index,position)=>{
    const wrote=steps[index]!.action==="expectText"?steps[index]!.text!:steps[index]!.value!,other=String(results[position]??"");
    return agrees(wrote,other)?[]:[`Step ${index+1} expects "${wrote}", but working it out independently gives "${other}". Read the request again and use the correct result.`];
  });
}
export const readSiteSteps=(dir:string):SiteStep[]=>parseSiteSteps(JSON.parse(fs.readFileSync(path.join(dir,SITE_SPEC_FILE),"utf8")));
export function sitePrompt(goal:string,dir:string,previous?:string):string{
  return[
    "Write the complete single-file web page. Return only the HTML document from <!doctype html> to </html>, no explanation.",
    "The request from the owner:\n"+goal,
    "Inline CSS and JavaScript, no external files or network requests. Attach handlers with addEventListener; never name a function the same as an element id. Clean design that fits a phone without sideways scrolling, with a viewport meta tag. Match the language of the request; for Arabic use dir=rtl.",
    "These locked acceptance steps run in a real browser: every #id they use must exist, and they must pass exactly as written:\n"+fs.readFileSync(path.join(dir,SITE_SPEC_FILE),"utf8"),
    previous?"The previous version failed:\n"+previous.slice(0,1800):""
  ].filter(Boolean).join("\n\n");
}
export function buildSitePatchPrompt(dir:string,goal:string,observation:StaticObservation,previous?:string):string{
  return[
    "You fix one problem in a single-file web page with the smallest possible change. Return ONLY JSON:",
    '{"cause":"one sentence","edits":[{"path":"index.html","find":"exact text copied from the file","replace":"new text"}]}',
    "Rules: at most 3 edits. Each find must be copied exactly from the file and occur once; include enough of the line to be unique. Fix the cause: no empty try/catch and no printing the expected text without computing it.",
    "The request from the owner:\n"+goal,
    "What a real browser observed:\n"+observation.summary,
    "The locked acceptance steps:\n"+fs.readFileSync(path.join(dir,SITE_SPEC_FILE),"utf8"),
    "index.html:\n"+fs.readFileSync(path.join(dir,SITE_FILE),"utf8").slice(0,SITE_PROMPT_BUDGET),
    previous?"Your previous attempt did not solve it:\n"+previous.slice(0,1500):""
  ].filter(Boolean).join("\n\n");
}
/** The page's own errors plus the locked steps, driven in a real browser on phone and desktop sizes. */
export async function observeSite(dir:string,goal:string):Promise<StaticObservation>{
  // «quoted» text in a repair report must already be on the page; in a request it may appear only after a click, which the steps check.
  const page=await observeStaticProject(dir,goal.replace(/[«»]/g,""));
  const blank=!page.pages.find(p=>p.page===SITE_FILE)?.text.trim();
  const steps=readSiteSteps(dir);
  const served=await serveStatic(dir);
  try{
    const url=served.base+SITE_FILE;
    const driven=await createBrowserTestAdapter().execute({missionId:"site-check",agentId:"core",projectId:path.basename(dir),tool:"browser.test",action:"test web page",permission:"L2_ANALYZE",idempotencyKey:randomUUID(),
      payload:{url,viewports:["desktop","mobile"],pageText:false,steps:steps.map(step=>step.action==="reload"?{action:"goto",url}:step)}} as never) as {problems:string[]};
    const problems=[...(blank?["The page shows nothing."]:[]),...driven.problems];
    const summary=[page.ok?"":page.summary,...problems].filter(Boolean).join("\n").slice(0,2200);
    const signature=[page.signature,...problems].filter(Boolean).join("|");
    return{...page,ok:page.ok&&!problems.length,summary:summary||"The page loads cleanly and every acceptance step passes.",signature};
  }finally{await served.close();}
}

/** A server that runs but misbehaves: one targeted patch before throwing the file away. */
export function buildRuntimePatchPrompt(file:string,source:string,failure:string):string{
  return[
    "One file of a Node project runs but behaves wrongly. Fix it with the smallest possible change. Return ONLY JSON:",
    `{"cause":"one sentence","edits":[{"path":"${file}","find":"exact text copied from the file","replace":"new text"}]}`,
    "Rules: at most 3 edits. Each find must be copied exactly from the file and occur once. Fix the cause; no empty try/catch. document, window and localStorage exist only inside browser code.",
    "What went wrong when it ran:\n"+failure.slice(0,2000),
    `${file}:\n`+source.slice(0,9000)
  ].join("\n\n");
}
export const RUNTIME_FAILURE=/HTTP behavior failed|ReferenceError|TypeError|is not defined|Cannot read propert|is not a function/;
