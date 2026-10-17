import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

/**
 * The dashboard's "Current mission" card shows the whole autonomous job, never one of its stages:
 * the owner saw "Overall goal: …  3/3  100%  in progress" long after the website job had ended,
 * and could not tell whether it was finished or where the site was.
 */
const WEB=path.resolve("web");
const ago=(min:number)=>new Date(Date.now()-min*60_000).toISOString();
const tools=(n:number)=>Array.from({length:n},(_,i)=>({tool:i<n-1?"files.read":"files.write",action:"x",permission:"L1_READ",reason:"agent",payload:{path:"next/metadata.ts"}}));
const audit=(id:string,n:number)=>tools(n).map((x,i)=>({timestamp:ago(15),actor:"coder",action:x.action,resource:x.tool,result:"success",metadata:{missionId:id,planIndex:i}}));
const GOAL="Build a professional website for a computer shop";
const stage=(id:string,status:string,min:number)=>({id,projectId:"default",goal:`Overall goal: ${GOAL}\nAcceptance criteria: …\nCurrent milestone (2/3): pages`,status,createdAt:ago(min),tools:tools(3),steps:[]});
const job=(status:string,missions:string[],extra:Record<string,unknown>={})=>({id:"job-1",projectId:"default",goal:GOAL,status,trust:"trusted",createdAt:ago(60),updatedAt:ago(14),log:[],acceptance:[],notes:[],externalUsed:[],
  milestones:[{title:"Plan",status:"done",agent:"researcher",attempts:1,missions:[]},{title:"Pages",status:status==="completed"?"done":"running",agent:"coder",attempts:1,missions},{title:"Checks",status:status==="completed"?"done":"pending",agent:"coder",attempts:status==="completed"?1:0,missions:[]}],
  current:status==="completed"?3:1,...extra});

type World={jobs:unknown[];missions:Array<{id:string;tools:unknown[]}>};
function server(world:World){
  const s=http.createServer((req,res)=>{
    const url=(req.url??"/").split("?")[0]!;
    const send=(d:unknown,code=200)=>{res.writeHead(code,{"content-type":"application/json"});res.end(JSON.stringify(d));};
    if(url==="/"||url==="/index.html"){res.writeHead(200,{"content-type":"text/html; charset=utf-8"});res.end(fs.readFileSync(path.join(WEB,"index.html")));return;}
    if(url==="/app.js"||url==="/styles.css"){res.writeHead(200,{"content-type":url.endsWith(".js")?"text/javascript":"text/css"});res.end(fs.readFileSync(path.join(WEB,url.slice(1))));return;}
    if(url==="/v1/setup/status")return send({owner:{name:"Owner"},workspace:{root:"C:\\Users\\me\\LayanX-Projects",projects:["default"],linked:[]},capabilities:{},secrets:{names:[]}});
    if(url==="/v1/supervisor/jobs")return send({ok:true,jobs:world.jobs});
    if(url==="/v1/missions")return send({ok:true,missions:world.missions});
    const m=url.match(/^\/v1\/missions\/([^/]+)$/);
    if(m){const x=world.missions.find(y=>y.id===m[1]);return x?send({ok:true,mission:x,audit:audit(x.id,x.tools.length)}):send({},404);}
    if(url==="/v1/approvals")return send({ok:true,approvals:[]});
    send({},404);
  });
  return new Promise<{url:string;close:()=>void}>(r=>s.listen(0,"127.0.0.1",()=>r({url:`http://127.0.0.1:${(s.address() as {port:number}).port}`,close:()=>s.close()})));
}

let pw:any;try{pw=await import("playwright-core");}catch{pw=null;}
const chromium=pw?.chromium??pw?.default?.chromium;
let browser:any=null;
if(chromium)for(const a of [...(process.env.LAYANX_BROWSER_PATH?[{executablePath:process.env.LAYANX_BROWSER_PATH}]:[]),{channel:"msedge"},{channel:"chrome"}]){try{browser=await chromium.launch({headless:true,...a});break;}catch{}}
if(!browser){console.log("dashboard-job-card: skipped (no browser)");process.exit(0);}

async function dashboard(world:World){
  const srv=await server(world);
  const page=await browser.newPage();const errors:string[]=[];page.on("pageerror",(e:Error)=>errors.push(String(e)));
  await page.addInitScript(`try{localStorage.setItem("lx.cc.lang","ar")}catch(e){}`);
  await page.goto(srv.url+"/#dashboard");
  await page.waitForSelector("#curMission",{timeout:15000});
  await page.waitForFunction(()=>!document.querySelector("#curMission .empty")||document.querySelector("#curMission")!.textContent!.length>0);
  const card=await page.$eval("#curMission",(e:HTMLElement)=>e.innerText);
  const active=await page.$eval("#kpis .kpi b",(e:HTMLElement)=>e.innerText);
  const openSite=await page.$$eval("#curMission button",(bs:HTMLElement[])=>bs.some(b=>b.innerText.includes("افتح الموقع")));
  const canDelete=await page.$$eval("#curMission button",(bs:HTMLElement[])=>bs.some(b=>b.innerText.trim()==="حذف"));
  await page.close();srv.close();
  assert.deepEqual(errors,[]);
  return{card,active,openSite,canDelete};
}

try{
  // 1. The job has finished; one stage's mission was left "running" (its model answer was not JSON), and is not even listed in the job.
  {
    const {card,active,openSite,canDelete}=await dashboard({jobs:[job("completed",["m-done"])],missions:[stage("m-stale","running",16),stage("m-done","completed",30)]});
    assert.ok(canDelete,"a job made by mistake can be deleted from its card");
    assert.ok(card.includes(GOAL),card);
    assert.ok(!card.includes("Overall goal"),"never the internal stage text: "+card);
    assert.ok(card.includes("اكتملت"),"the job's real state: "+card);
    assert.ok(!card.includes("قيد التنفيذ"),card);
    assert.ok(openSite,"the open-the-site button is on the dashboard");
    assert.ok(card.includes("C:\\Users\\me\\LayanX-Projects\\default"),"where the files are: "+card);
    assert.equal(active,"0","a finished job and a stale stage are not active work");
  }
  // 2. The job is running: the job is shown, and counted once (not again for its stage).
  {
    const {card,active}=await dashboard({jobs:[job("running",["m-run"])],missions:[stage("m-run","running",2)]});
    assert.ok(card.includes(GOAL)&&card.includes("يعمل")&&!card.includes("Overall goal"),card);
    assert.equal(active,"1");
  }
  // 3. A mission of its own, still choosing its next step after 3 done: not "3/3 100%".
  {
    const own={id:"m-own",projectId:"default",goal:"افتح المتصفح وابحث عن أسعار الذاكرة",status:"running",createdAt:ago(1),tools:tools(3),steps:[]};
    const {card,active}=await dashboard({jobs:[],missions:[own]});
    assert.ok(card.includes("افتح المتصفح"),card);
    assert.ok(card.includes("3 خطوات منجزة")&&!card.includes("100%")&&!card.includes("3/3"),card);
    assert.equal(active,"1");
  }
}finally{await browser.close();}
console.log("dashboard-job-card: the dashboard shows the whole job (state, open-the-site button, folder), never a stale stage");
process.exit(0);
