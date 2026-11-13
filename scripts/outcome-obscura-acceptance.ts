/**
 * Obscura beside Chromium, on real public pages. The judge is this script: each page has text that only appears after
 * the page's JavaScript runs (or a fixed known phrase), and each engine is judged on the text it returned.
 *
 *   npx tsx scripts/outcome-obscura-acceptance.ts [--runs=3]
 */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {resolveDataPaths} from "../src/platform/paths.js";
import {createPageRenderAdapter,findObscura} from "../src/tools/page-render.js";

const runs=Number(process.argv.find(a=>a.startsWith("--runs="))?.split("=")[1]??3);
const pages=[
  // Quotes are written into the page by JavaScript; the raw HTML holds them only inside a script.
  {name:"js-quotes",url:"https://quotes.toscrape.com/js/",must:[/The world as we have created it is a process of our thinking/,/Albert Einstein/],mustNot:[/var data\s*=/]},
  {name:"static",url:"https://books.toscrape.com/",must:[/A Light in the/,/£51.77/],mustNot:[]},
  {name:"wikipedia-ar",url:"https://ar.wikipedia.org/wiki/%D8%A7%D9%84%D9%8A%D9%85%D9%86",must:[/اليمن/,/صنعاء/],mustNot:[]}
];
const exe=findObscura();
if(!exe){console.error("Obscura is not installed: run scripts\\windows\\install-obscura.ps1");process.exit(2);}
const adapter=createPageRenderAdapter();
const rows:any[]=[];
for(let run=1;run<=runs;run++)for(const page of pages)for(const engine of ["obscura","chromium"] as const){
  const began=Date.now();
  try{
    const r=await adapter.execute({tool:"browser.render",action:"read",payload:{url:page.url,engine},projectId:"default",missionId:"obscura-trial"} as any) as any;
    const ok=r.engine===engine&&page.must.every(re=>re.test(r.text))&&!page.mustNot.some(re=>re.test(r.text));
    rows.push({run,page:page.name,engine,ok,ms:Date.now()-began,chars:r.text.length});
  }catch(error){rows.push({run,page:page.name,engine,ok:false,ms:Date.now()-began,error:String((error as Error).message).slice(0,200)});}
  const last=rows.at(-1);console.log(`${run} ${page.name} ${engine}: ${last.ok?"PASS":"FAIL"} ${last.ms}ms${last.error?" "+last.error:""}`);
}
// Refusals, through the real engines' tool: local addresses never reach either engine.
const refused:boolean[]=[];
for(const url of ["http://127.0.0.1:3000/","http://localhost:3000/setup","http://192.168.1.1/"]){
  try{await adapter.execute({tool:"browser.render",action:"read",payload:{url},projectId:"default",missionId:"obscura-trial"} as any);refused.push(false);}catch{refused.push(true);}
}
const by=(engine:string)=>{const r=rows.filter(x=>x.engine===engine);const ms=r.filter(x=>x.ok).map(x=>x.ms).sort((a,b)=>a-b);return{passed:r.filter(x=>x.ok).length,total:r.length,medianMs:ms[Math.floor(ms.length/2)]??null};};
const result={at:new Date().toISOString(),obscura:exe,runs,obscuraResult:by("obscura"),chromiumResult:by("chromium"),localRefused:refused.every(Boolean),rows};
const ok=result.obscuraResult.passed===result.obscuraResult.total&&result.localRefused;
const dir=path.join(resolveDataPaths().dataDir,"outcome-runs");fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,`obscura-${result.at.replace(/[:.]/g,"-")}.json`);
const text=JSON.stringify({ok,...result},null,2);fs.writeFileSync(file,text);
console.log(JSON.stringify({ok,file,sha256:createHash("sha256").update(text).digest("hex").slice(0,16).toUpperCase(),obscura:result.obscuraResult,chromium:result.chromiumResult,localRefused:result.localRefused},null,2));
process.exit(ok?0:1);
