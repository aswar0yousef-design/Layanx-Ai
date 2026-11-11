/**
 * The program is read again with fresh eyes, and each objection has to survive contact with reality. The reviewer names inputs
 * it believes the program gets wrong and the output each should give. A second model, which never sees the program, states
 * what each input should give. Only where they agree does the case become a locked test, and only a failing test sends the
 * work back. A reviewer's opinion alone never rejects anything, because small models are often confidently wrong.
 */
export interface ReviewCase{args:string[];stdin:string;code:number;stdout:string;why:string}
export const REVIEW_TEST_FILE="tests/review.test.mjs";
const MAX_CASES=3;

export function reviewPrompt(goal:string,program:string,tests:string):string{
  return[
    "You review a command-line program another engineer wrote. Find inputs where it gives the WRONG result according to the request. Return ONLY JSON:",
    '{"cases":[{"args":["arg1"],"stdin":"","code":0,"stdout":"exact correct output","why":"why the program gets this wrong"}]}',
    `Read the code line by line and trace it by hand. Give at most ${MAX_CASES} cases, only for what the request asks for, and none that the existing tests already cover. If you find no real bug, return {"cases":[]}. code is the correct exit code; stdout is the exact correct output, or "" when the program must fail.`,
    "The request:\n"+goal,
    "The program:\n"+program.slice(0,7000),
    "Existing tests (already passing):\n"+tests.slice(0,3000)
  ].join("\n\n");
}
/** Models often write \\n in JSON where they mean a line break. A locked test built on that can never be passed by a correct program. */
const realLineBreaks=(text:string)=>text.includes("\n")||!/\\[nt]/.test(text)?text:text.replace(/\\r\\n|\\n/g,"\n").replace(/\\t/g,"\t");
const expectedOutput=(text:string)=>{try{JSON.parse(text);return text;}catch{return realLineBreaks(text);}};
export function parseReviewCases(raw:unknown,limit=MAX_CASES):ReviewCase[]{
  const cases=Array.isArray(raw)?raw:(raw as {cases?:unknown}|null)?.cases;
  if(!Array.isArray(cases))throw new Error("Unusable output: invalid JSON, no cases array.");
  return cases.slice(0,limit).filter((item:any)=>item&&Array.isArray(item.args)&&typeof item.stdout==="string"&&Number.isInteger(item.code))
    .map((item:any)=>({args:item.args.map(String),stdin:typeof item.stdin==="string"?realLineBreaks(item.stdin):"",code:item.code,stdout:expectedOutput(item.stdout),why:String(item.why??"").slice(0,300)}));
}
export function secondOpinionPrompt(goal:string,cases:ReviewCase[]):string{
  return[
    "A command-line program must follow this request. Without seeing any code, work out what it must do for each input below. Return ONLY JSON:",
    '{"answers":[{"code":0,"stdout":"exact correct output"}]}',
    'One answer per input, in order. code is the exit code; stdout is the exact output, or "" when the program must fail.',
    "The request:\n"+goal,
    "Inputs:\n"+JSON.stringify(cases.map(item=>({args:item.args,stdin:item.stdin})))
  ].join("\n\n");
}
const normal=(text:string)=>{const trimmed=text.trim();try{return JSON.stringify(JSON.parse(trimmed));}catch{return trimmed;}};
/** A failure's wording is not part of the contract; only that it failed. */
export function agreedCases(cases:ReviewCase[],raw:unknown):ReviewCase[]{
  const answers=Array.isArray(raw)?raw:(raw as {answers?:unknown}|null)?.answers;
  if(!Array.isArray(answers))throw new Error("Unusable output: invalid JSON, no answers array.");
  return cases.filter((item,i)=>{
    const other=answers[i] as {code?:unknown;stdout?:unknown}|undefined;
    if(!other||other.code!==item.code)return false;
    return item.code!==0||normal(String(other.stdout??""))===normal(item.stdout);
  });
}
/** Confirmed cases are kept across attempts, so one bad round does not throw away what two models already agreed on. */
export function mergeCases(kept:ReviewCase[],added:ReviewCase[],limit:number):ReviewCase[]{
  const key=(item:ReviewCase)=>JSON.stringify([item.args,item.stdin]),seen=new Set<string>();
  return[...kept,...added].filter(item=>!seen.has(key(item))&&Boolean(seen.add(key(item)))).slice(0,limit);
}
const inputLabel=(item:ReviewCase)=>`[args=${JSON.stringify(item.args)} stdin=${JSON.stringify(item.stdin).slice(0,120)}]`;
export function reviewTestSource(cases:ReviewCase[]):string{
  const body=cases.map((item,i)=>`test(${JSON.stringify(`review ${i+1}: ${(item.why||item.args.join(" ")).slice(0,90)} ${inputLabel(item)}`)},async()=>{\n  const r=await cli(${JSON.stringify(item.args)},${JSON.stringify(item.stdin)});\n  assert.equal(r.code,${item.code});\n${item.code===0?`  same(r.stdout.trim(),${JSON.stringify(item.stdout.trim())});\n`:""}});`).join("\n");
  return`import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport {cli} from './helpers.mjs';\nconst same=(got,want)=>{let a,b;try{a=JSON.parse(got);b=JSON.parse(want);}catch{assert.equal(got,want);return;}assert.deepEqual(a,b);};\n${body}\n`;
}
