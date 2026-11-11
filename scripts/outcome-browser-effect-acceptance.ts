/**
 * Browser actions that must take effect, checked from outside. (1) A task app that LayanX itself built, driven through
 * browser.test while this script asks its HTTP API what really happened. (2) A long task on a real public site, checked
 * against that site's own API. No account or login is involved.
 *
 *   npx tsx scripts/outcome-browser-effect-acceptance.ts [--app <folder of a generated task app>]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {pathToFileURL} from "node:url";
import {createBrowserTestAdapter} from "../src/autonomy/browser-test.js";
import {resolveDataPaths} from "../src/platform/paths.js";

const arg=(name:string)=>{const i=process.argv.indexOf("--"+name);return i>=0?process.argv[i+1]:undefined;};
const runs=path.join(resolveDataPaths().dataDir,"outcome-runs");
function findBuiltApp():string|undefined{
  for(const run of fs.readdirSync(runs).filter(n=>/-chat-/.test(n)).sort().reverse()){
    const result=path.join(runs,run,"chat-result.json");
    if(!fs.existsSync(result))continue;
    const parsed=JSON.parse(fs.readFileSync(result,"utf8"));
    if(parsed.scenario==="build"&&parsed.ok===true)return path.join(runs,run,"projects",parsed.projectId);
  }
  return undefined;
}
const adapter=createBrowserTestAdapter();
const drive=(url:string,steps:unknown[])=>adapter.execute({missionId:"effect",agentId:"core",projectId:"effect",tool:"browser.test",action:"test web page",permission:"L2_ANALYZE",idempotencyKey:randomUUID(),payload:{url,steps,viewports:["desktop"],pageText:true}} as never) as Promise<any>;
const checks:Array<{check:string;ok:boolean;detail?:unknown}>=[];
const record=(check:string,ok:boolean,detail?:unknown)=>{checks.push({check,ok,...(detail!==undefined?{detail}:{})});console.log(ok?"PASS":"FAIL",check,detail===undefined?"":JSON.stringify(detail).slice(0,500));};

// ---------- the app LayanX built
const source=arg("app")??findBuiltApp();
if(!source)record("a task app built by LayanX exists",false);
else{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"lx-browser-app-"));
  fs.cpSync(source,dir,{recursive:true,filter:file=>!/[\\/]\.git|[\\/]node_modules|tasks\.json$/.test(file)});
  const port=20000+Math.floor(Math.random()*20000);
  const boot=`import(${JSON.stringify(pathToFileURL(path.join(dir,"src/server.mjs")).href)}).then(m=>m.createServer().listen(${port},'127.0.0.1'))`;
  const server=spawn(process.execPath,["-e",boot],{cwd:dir,windowsHide:true,stdio:"ignore",env:{...process.env,LAYANX_TASKS_FILE:path.join(dir,"tasks-test.json")}});
  const url=`http://127.0.0.1:${port}/`;
  try{
    for(let i=0;i<40;i++){if(await fetch(url+"health").then(r=>r.ok,()=>false))break;await new Promise(r=>setTimeout(r,250));}
    const list=async()=>((await (await fetch(url+"tasks")).json()) as {tasks:Array<{id:string;title:string}>}).tasks;
    const title="مهمة من المتصفح "+randomUUID().slice(0,6);
    const html=await (await fetch(url)).text();
    const addLabel=/إضافة/.test(html)?"إضافة":"Add";
    const added=await drive(url,[{action:"fill",selector:"input",value:title},{action:"click",selector:`button:has-text("${addLabel}")`},{action:"expectText",text:title}]);
    const afterAdd=await list();
    record("adding through the page puts the task on the server",added.results[0].steps.length===3&&!added.results[0].steps.some((s:string)=>/no visible change/.test(s))&&afterAdd.some(t=>t.title===title),{steps:added.results[0].steps,problems:added.problems,tasks:afterAdd.length});
    const reopened=await drive(url,[{action:"expectText",text:title}]);
    record("the task is still there in a new browser session",reopened.results[0].steps.length===1,reopened.problems);
    const deleteLabel=/حذف/.test(html)?"حذف":"Delete";
    const removed=await drive(url,[{action:"expectText",text:title},{action:"click",selector:`button:has-text("${deleteLabel}")`},{action:"expectCount",selector:`text=${title}`,value:"0"}]);
    const afterDelete=await list();
    record("deleting through the page removes it from the server",removed.results[0].steps.length===3&&!afterDelete.some(t=>t.title===title),{steps:removed.results[0].steps,problems:removed.problems,tasks:afterDelete.length});
    const wrong=await drive(url,[{action:"expectText",text:"text that is not on this page at all",ms:1000}]);
    record("a step that did not happen is reported as a failure",wrong.ok===false&&wrong.problems.some((p:string)=>/Expected text/.test(p)),wrong.problems);
  }finally{server.kill();}
}

// ---------- a long task on a real public site, judged by that site's own API
const SITE="https://en.wikipedia.org/wiki/Main_Page";
const long=await drive(SITE,[
  {action:"fill",selector:"input[name=search]",value:"Riyadh"},
  {action:"expectValue",selector:"input[name=search]",value:"Riyadh"},
  {action:"press",key:"Enter"},
  {action:"wait",selector:"h1#firstHeading"},
  {action:"expectText",text:"capital"},
  {action:"snapshot"},
  {action:"click",selector:"#mw-content-text a[title='Saudi Arabia']"},
  {action:"wait",selector:"h1#firstHeading"},
  {action:"expectText",text:"Saudi Arabia"},
  {action:"click",selector:"#mw-content-text a[title='Red Sea']"},
  {action:"wait",selector:"h1#firstHeading"},
  {action:"expectText",text:"Red Sea"}
]);
const finished=long.results[0];
const finalTitle=decodeURIComponent(String(finished.finalUrl).split("/wiki/")[1]??"").split("#")[0]!;
const api=await fetch("https://en.wikipedia.org/api/rest_v1/page/summary/"+finalTitle,{headers:{"user-agent":"LayanX-acceptance/1"}}).then(r=>r.json(),()=>({})) as {title?:string};
record("a 12-step task on a real site reached the right page",finished.steps.length===12&&api.title==="Red Sea",{finalUrl:finished.finalUrl,apiTitle:api.title,steps:finished.steps.length,stepProblem:finished.problems.filter((p:string)=>p.startsWith("step"))});
record("every click on that task changed the page",finished.steps.filter((s:string)=>s.startsWith("click")).length===2&&!finished.steps.some((s:string)=>/no visible change/.test(s)),finished.steps.filter((s:string)=>s.startsWith("click")));

const report={at:new Date().toISOString(),source:source??null,ok:checks.length>=6&&checks.every(c=>c.ok),passed:checks.filter(c=>c.ok).length,total:checks.length,checks};
const out=path.join(runs,"browser-effect-"+new Date().toISOString().replace(/[:.]/g,"-")+".json");
fs.writeFileSync(out,JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify({report:out,ok:report.ok,passed:report.passed,total:report.total}));
process.exit(report.ok?0:1);
