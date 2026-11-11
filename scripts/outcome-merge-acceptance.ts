/**
 * Does merging beat one model? The same questions with known answers go to each model alone and to the merge. The answers
 * are scored by this script. Nothing is tuned to these questions.
 *
 *   npx tsx scripts/outcome-merge-acceptance.ts [--models a,b,c] [--merger a]
 */
import fs from "node:fs";
import path from "node:path";
import {resolveDataPaths} from "../src/platform/paths.js";
import {mergeModels} from "../src/core/model-merge.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
const models=(arg("models")??"gpt-oss:20b,gemma4:12b,qwen3.5:9b").split(",");
const merger=arg("merger")??models[0]!;
const base=process.env.OLLAMA_BASE_URL||"http://127.0.0.1:11434";
const ask=async(input:string,model:string,max:number)=>{
  const response=await fetch(base+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},signal:AbortSignal.timeout(180_000),body:JSON.stringify({model,stream:false,messages:[{role:"user",content:input}],options:{num_predict:max,num_ctx:8192,temperature:0.2}})});
  if(!response.ok)throw new Error("HTTP "+response.status);
  const data=await response.json() as {message?:{content?:string}};
  return{output:String(data.message?.content??"")};
};
const digits=(text:string)=>text.replace(/[٠-٩]/g,d=>String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/(\d),(\d)/g,"$1$2");
const number=(n:string)=>new RegExp("(?<![\\d.])"+n.replace(".","\\.")+"(?![\\d]|\\.\\d)");
const Q:Array<{q:string;right:RegExp;wrong?:RegExp}>=[
  {q:"A bat and a ball cost 1.10 dollars in total. The bat costs 1.00 dollar more than the ball. How many cents does the ball cost? Give the final number.",right:/\b5\b|\b0\.05\b/,wrong:/\b10 cents\b/},
  {q:"What is 17 multiplied by 23? Give the final number.",right:number("391")},
  {q:"How many times does the letter r appear in the word strawberry? Give the final number.",right:/\b3\b|three/i},
  {q:"ما عاصمة أستراليا؟",right:/كانبرا|canberra/i},
  {q:"If today is Wednesday, what day of the week is it 100 days from now?",right:/friday|الجمعة/i},
  {q:"What is the sum of all integers from 1 to 40? Give the final number.",right:number("820")},
  {q:"كم عدد أيام سنة 2024؟",right:number("366")},
  {q:"Sally has 3 brothers. Each brother has 2 sisters. How many sisters does Sally have? Give the final number.",right:/\b1\b|\bone\b/i},
  {q:"Which number is larger: 9.11 or 9.9? Give only the larger number.",right:number("9.9"),wrong:/(?:is|answer:?|larger:?)\s*\*{0,2}9\.11/i},
  {q:"A train leaves at 14:45 and the trip takes 3 hours and 40 minutes. At what time does it arrive, in 24-hour format?",right:/18:25/},
  {q:"ما ناتج 15% من 240؟",right:number("36")},
  {q:"Name the chemical symbol of sodium.",right:/\bNa\b/}
];
const score=(answer:string,item:(typeof Q)[number])=>item.right.test(digits(answer))&&!item.wrong?.test(answer);
const tally:Record<string,number>=Object.fromEntries([...models,"merged"].map(m=>[m,0]));
const rows:any[]=[];let times=0,disagreedAndRight=0;
for(const item of Q){
  const started=Date.now();
  const result=await mergeModels({question:item.q,models,merger,ask});
  times+=Date.now()-started;
  const singles=Object.fromEntries(result.sources.map(s=>[s.model,Boolean(s.ok&&score(s.answer!,item))]));
  for(const[model,right]of Object.entries(singles))if(right)tally[model]!++;
  const mergedRight=score(result.answer,item);
  if(mergedRight)tally.merged!++;
  if(mergedRight&&Object.values(singles).some(v=>!v))disagreedAndRight++;
  rows.push({q:item.q.slice(0,60),merged:mergedRight,mergedAnswer:result.answer.slice(0,200),wasMerged:result.merged,agreement:result.agreement,singles,errors:result.sources.filter(s=>!s.ok).map(s=>s.model+": "+s.error)});
  console.log(JSON.stringify(rows.at(-1)));
}
const bestSingle=Math.max(...models.map(m=>tally[m]!));
const report={at:new Date().toISOString(),models,merger,total:Q.length,correct:tally,bestSingle,mergedAtLeastBest:tally.merged!>=bestSingle,rescued:disagreedAndRight,averageSeconds:Math.round(times/Q.length/1000),rows};
const out=path.join(resolveDataPaths().dataDir,"outcome-runs","merge-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({report:out,correct:tally,total:Q.length,bestSingle,mergedAtLeastBest:report.mergedAtLeastBest,rescued:disagreedAndRight,averageSeconds:report.averageSeconds}));
