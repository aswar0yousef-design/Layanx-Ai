import fs from "node:fs";
import path from "node:path";
import type {ToolAdapter} from "../tools/executor.js";
import type {ToolRequest} from "../core/types.js";
import {projectDir} from "./project-dir.js";
import {ensureLayanxIgnore} from "./knowledge.js";

/**
 * browser.test: look at what was built, the way a person would.
 * Uses the Edge or Chrome already installed (playwright-core, no browser download).
 *
 * payload: {url, steps?:[{action:"click"|"fill"|"press"|"wait"|"goto"|"expectText"|"snapshot", selector?, text?, value?, key?, ms?, url?}],
 *           viewports?:["desktop","mobile"], baseline?:"home", updateBaseline?:false, fullPage?:false, maxDiff?:0.02, pageText?:true}
 * returns:  ok, title, finalUrl, consoleErrors, pageErrors, failedRequests, accessibility, screenshots, visual diffs,
 *           pageText: the page as an accessibility snapshot (roles, names, text) so a model without vision can read it.
 *           A "snapshot" step records the page text at that moment of a flow.
 */
const VIEWPORTS:Record<string,{width:number;height:number;isMobile?:boolean;deviceScaleFactor?:number}>={
  desktop:{width:1280,height:800},mobile:{width:390,height:844,isMobile:true,deviceScaleFactor:2},tablet:{width:820,height:1180,isMobile:true}
};
type Step={action:string;selector?:string;text?:string;value?:string;key?:string;ms?:number;url?:string};

let browserPromise:Promise<any>|null=null;
async function browser():Promise<any>{
  if(browserPromise)return browserPromise;
  browserPromise=(async()=>{
    let pw:any;
    try{pw=await import(process.env.LAYANX_PLAYWRIGHT_MODULE??"playwright-core");}
    catch{throw new Error("Browser testing needs the playwright-core package. Run: npm install");}
    const chromium=pw.chromium??pw.default?.chromium;
    const attempts:Array<Record<string,unknown>>=[
      ...(process.env.LAYANX_BROWSER_PATH?[{executablePath:process.env.LAYANX_BROWSER_PATH}]:[]),
      {channel:"msedge"},{channel:"chrome"}
    ];
    const errors:string[]=[];
    for(const a of attempts){try{return await chromium.launch({headless:true,...a});}catch(e){errors.push(String((e as Error).message).split("\n")[0]!);}}
    throw new Error("No Edge or Chrome browser could be started: "+errors.join(" | "));
  })();
  browserPromise.catch(()=>{browserPromise=null;});
  return browserPromise;
}
export async function closeBrowser(){if(browserPromise){try{(await browserPromise).close();}catch{}browserPromise=null;}}
process.once("exit",()=>{void closeBrowser();});

function safeName(v:unknown,fallback:string){const s=typeof v==="string"?v.trim():"";return /^[\w.-]{1,40}$/.test(s)?s:fallback;}
function checkUrl(raw:unknown):string{
  if(typeof raw!=="string")throw new Error("url is required.");
  const u=new URL(raw);
  if(u.protocol!=="http:"&&u.protocol!=="https:")throw new Error("Only http and https pages can be tested.");
  if(u.username||u.password)throw new Error("URLs with credentials are not allowed.");
  return u.toString();
}

const PAGE_TEXT_LIMIT=6000;
/** The page as text: Playwright's ARIA snapshot (role "name" lines), the way screen readers see it. */
async function pageText(page:any):Promise<string|null>{
  try{const text=await page.locator("body").ariaSnapshot({timeout:5000});return typeof text==="string"?text.slice(0,PAGE_TEXT_LIMIT):null;}
  catch{return null;}
}

async function runSteps(page:any,steps:Step[],snapshots:string[]){
  const done:string[]=[];
  for(const s of steps.slice(0,30)){
    const target=s.selector?page.locator(s.selector).first():s.text?page.getByText(s.text,{exact:false}).first():null;
    switch(s.action){
      case "goto":await page.goto(checkUrl(s.url),{waitUntil:"load",timeout:30000});break;
      case "click":if(!target)throw new Error("click needs selector or text");await target.click({timeout:10000});break;
      case "fill":if(!target)throw new Error("fill needs selector");await target.fill(String(s.value??""),{timeout:10000});break;
      case "press":await page.keyboard.press(String(s.key??"Enter"));break;
      case "wait":if(target)await target.waitFor({timeout:Math.min(s.ms??10000,30000)});else await page.waitForTimeout(Math.min(Math.max(s.ms??500,0),10000));break;
      case "snapshot":{const text=await pageText(page);if(text!==null&&snapshots.length<5)snapshots.push(text);break;}
      case "expectText":{const visible=await page.getByText(String(s.text??""),{exact:false}).first().isVisible().catch(()=>false);if(!visible)throw new Error(`Expected text not visible: ${s.text}`);break;}
      default:throw new Error("Unknown step action: "+s.action);
    }
    done.push(s.action+(s.selector?" "+s.selector:s.text?" "+s.text:""));
  }
  return done;
}

/**
 * Pixel difference ratio, computed in the browser with canvas (no image libraries needed).
 * Sent as plain source text: transpiled helpers (e.g. __name) do not exist inside the page.
 */
const A11Y_SOURCE=`(() => ({
  lang: document.documentElement.lang || null,
  imagesWithoutAlt: Array.from(document.images).filter(i => !i.hasAttribute("alt")).length,
  inputsWithoutLabel: Array.from(document.querySelectorAll("input:not([type=hidden]),select,textarea")).filter(el => { const id = el.getAttribute("id"); return !el.getAttribute("aria-label") && !el.closest("label") && !(id && document.querySelector('label[for="' + CSS.escape(id) + '"]')); }).length,
  buttonsWithoutName: Array.from(document.querySelectorAll("button,a[href]")).filter(el => !(el.textContent || "").trim() && !el.getAttribute("aria-label") && !el.getAttribute("title")).length,
  horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
  viewportMeta: Boolean(document.querySelector("meta[name=viewport]"))
}))()`;
const DIFF_SOURCE=`(async ([x, y]) => {
  if (!x || !y) return 1;
  const img = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("image")); i.src = src; });
  const pair = await Promise.all([img(x), img(y)]);
  const i1 = pair[0], i2 = pair[1];
  const w = Math.min(i1.width, i2.width), h = Math.min(i1.height, i2.height);
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
  g.drawImage(i1, 0, 0, w, h); const d1 = g.getImageData(0, 0, w, h).data;
  g.clearRect(0, 0, w, h); g.drawImage(i2, 0, 0, w, h); const d2 = g.getImageData(0, 0, w, h).data;
  let diff = 0;
  for (let p = 0; p < d1.length; p += 4) { if (Math.abs(d1[p] - d2[p]) > 40 || Math.abs(d1[p+1] - d2[p+1]) > 40 || Math.abs(d1[p+2] - d2[p+2]) > 40) diff++; }
  const sizePenalty = (i1.width !== i2.width || Math.abs(i1.height - i2.height) > i1.height * 0.1) ? 0.05 : 0;
  return Math.min(1, diff / (w * h) + sizePenalty);
})`;
async function diffRatio(page:any,a:string,b:string):Promise<number>{
  return page.evaluate(`${DIFF_SOURCE}(${JSON.stringify([a,b])})`);
}

export function createBrowserTestAdapter():ToolAdapter{
  return{async execute(request:ToolRequest){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const url=checkUrl(input.url);
    const steps=Array.isArray(input.steps)?input.steps.filter((s):s is Step=>!!s&&typeof s==="object"&&typeof (s as Step).action==="string"):[];
    const viewports=(Array.isArray(input.viewports)?input.viewports:["desktop","mobile"]).filter((v):v is string=>typeof v==="string"&&v in VIEWPORTS).slice(0,3);
    const baseline=input.baseline===undefined?null:safeName(input.baseline,"page");
    const maxDiff=typeof input.maxDiff==="number"?Math.min(Math.max(input.maxDiff,0),1):0.02;
    let dir:string|null=null;try{dir=projectDir(request.projectId);}catch{}
    const b=await browser();
    const results=[];
    for(const vp of viewports){
      const ctx=await b.newContext({viewport:{width:VIEWPORTS[vp]!.width,height:VIEWPORTS[vp]!.height},isMobile:VIEWPORTS[vp]!.isMobile??false,deviceScaleFactor:VIEWPORTS[vp]!.deviceScaleFactor??1,locale:"ar"});
      const page=await ctx.newPage();
      const consoleErrors:string[]=[],pageErrors:string[]=[],failedRequests:string[]=[];
      page.on("console",(m:any)=>{if(m.type()==="error")consoleErrors.push(String(m.text()).slice(0,300));});
      page.on("pageerror",(e:Error)=>pageErrors.push(String(e.message).slice(0,300)));
      page.on("requestfailed",(r:any)=>failedRequests.push(r.method()+" "+String(r.url()).slice(0,200)+" "+(r.failure()?.errorText??"")));
      page.on("response",(r:any)=>{if(r.status()>=400)failedRequests.push(r.status()+" "+String(r.url()).slice(0,200));});
      const started=Date.now();let status=0,stepsDone:string[]=[],stepError:string|undefined;const snapshots:string[]=[];
      try{const resp=await page.goto(url,{waitUntil:"load",timeout:30000});status=resp?.status()??0;await page.waitForTimeout(400);stepsDone=await runSteps(page,steps,snapshots);}
      catch(e){stepError=String((e as Error).message).split("\n")[0];}
      const a11y=await page.evaluate(A11Y_SOURCE).catch(()=>null);
      const text:string|null=input.pageText!==false&&vp===viewports[0]?await pageText(page):null;
      const shot:Buffer=await page.screenshot({type:"jpeg",quality:70,fullPage:input.fullPage===true}).catch(()=>Buffer.alloc(0));
      const dataUrl="data:image/jpeg;base64,"+shot.toString("base64");
      let diff:number|null=null,baselineSaved=false;
      if(dir&&baseline&&shot.length){
        const bdir=path.join(dir,".layanx","baselines");const file=path.join(bdir,`${baseline}-${vp}.jpg`);
        if(fs.existsSync(file)&&input.updateBaseline!==true){diff=await diffRatio(page,"data:image/jpeg;base64,"+fs.readFileSync(file).toString("base64"),dataUrl).catch(()=>null);}
        else{fs.mkdirSync(bdir,{recursive:true});fs.writeFileSync(file,shot);baselineSaved=true;}
      }
      if(dir&&shot.length){ensureLayanxIgnore(dir);const sdir=path.join(dir,".layanx","screens");fs.mkdirSync(sdir,{recursive:true});fs.writeFileSync(path.join(sdir,`${baseline??"last"}-${vp}.jpg`),shot);}
      const title=await page.title().catch(()=>"");const finalUrl=page.url();
      await ctx.close();
      const problems=[...(stepError?["step: "+stepError]:[]),...(status>=400?["HTTP "+status]:[]),...pageErrors.map(e=>"page error: "+e),...consoleErrors.map(e=>"console: "+e),...failedRequests.map(r=>"request: "+r),
        ...(a11y?.horizontalOverflow?["layout: page scrolls sideways"]:[]),...(diff!==null&&diff>maxDiff?[`visual change ${(diff*100).toFixed(1)}% vs baseline "${baseline}"`]:[])];
      results.push({viewport:vp,status,title,finalUrl,durationMs:Date.now()-started,steps:stepsDone,consoleErrors,pageErrors,failedRequests:failedRequests.slice(0,20),accessibility:a11y,
        visualDiff:diff,baselineSaved,problems,...(text!==null?{pageText:text}:{}),...(snapshots.length?{snapshots}:{}),screenshot:{mimeType:"image/jpeg",base64:shot.length<900_000?shot.toString("base64"):"",bytes:shot.length}});
    }
    const problems=results.flatMap(r=>r.problems.map(p=>r.viewport+": "+p));
    return{ok:problems.length===0,url,problems,results};
  }};
}
