/**
 * Independent visual interaction gate for the local generated task app.
 * It must use an installed real Edge/Chrome browser. Missing browser or broken
 * controls count as a FAILED acceptance, never as a skipped success.
 *
 * Note: child process and browser contexts are not OS security sandboxes.
 */
import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {startTaskAppServer,stopTaskAppServer} from "./task-app-verifier.js";

export interface TaskAppUICheck{name:string;ok:boolean;detail:string}
export interface TaskAppUIResult {
  ok:boolean;
  checks:TaskAppUICheck[];
  blockers:string[];
  verificationScope:"browser-click-and-reload";
}
export const UI_CHECKS=[
  "browser-start",
  "desktop-create","desktop-reload","desktop-delete","desktop-delete-reload",
  "mobile-create","mobile-reload","mobile-delete","mobile-delete-reload"
] as const;

export async function verifyTaskAppUI(workspace:string):Promise<TaskAppUIResult>{
  const checks:TaskAppUICheck[]=[],blockers:string[]=[];
  const result=():TaskAppUIResult=>({ok:blockers.length===0&&checks.length===UI_CHECKS.length,
    checks,blockers,verificationScope:"browser-click-and-reload"});
  const record=async(name:string,fn:()=>Promise<void>)=>{
    try{await fn();checks.push({name,ok:true,detail:"Observed in real browser"});}
    catch(error){const detail=error instanceof Error?error.message:String(error);
      checks.push({name,ok:false,detail:detail.slice(0,500)});blockers.push(name+": "+detail.slice(0,500));throw error;}
  };
  let browser:any=null,child:Awaited<ReturnType<typeof startTaskAppServer>>["child"]|undefined;
  const storage=path.join(workspace,".layanx","acceptance-ui-"+randomUUID()+".json");
  try{
    const serverFile=path.join(workspace,"src","server.mjs");
    if(!fs.existsSync(serverFile))throw Error("Missing src/server.mjs");
    fs.mkdirSync(path.dirname(storage),{recursive:true});
    const started=await startTaskAppServer(serverFile,workspace,storage);
    child=started.child;
    let pw:any;
    try{pw=await import("playwright-core");}
    catch{throw Error("playwright-core is required for browser interaction verification");}
    const chromium=pw.chromium??pw.default?.chromium;
    if(!chromium)throw Error("playwright-core Chromium launcher is missing");
    const attempts:Array<Record<string,unknown>>=[
      ...(process.env.LAYANX_BROWSER_PATH?[{executablePath:process.env.LAYANX_BROWSER_PATH}]:[]),
      {channel:"msedge"},{channel:"chrome"}
    ];
    const errors:string[]=[];
    for(const launch of attempts){
      try{browser=await chromium.launch({headless:true,...launch});break;}
      catch(e){errors.push(String(e instanceof Error?e.message:e).split("\n")[0]!.slice(0,120));}
    }
    if(!browser)throw Error("No Edge or Chrome could start for UI verification: "+errors.join("; "));
    await record("browser-start",async()=>{if(!started.url.startsWith("http://127.0.0.1:"))throw Error("Not a local acceptance server");});
    for(const [viewport,width,height] of [["desktop",1280,800],["mobile",390,844]] as const){
      const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
      try{
        const page=await context.newPage();
        const failures:string[]=[];
        page.on("pageerror",(error:Error)=>failures.push(error.message.slice(0,180)));
        const response=await page.goto(started.url+"/",{waitUntil:"load",timeout:12000});
        if(!response?.ok())throw Error("UI page did not load successfully");
        const title="LayanX UI "+viewport+" "+randomUUID();
        const input=page.locator('[data-testid="task-input"]');
        const add=page.locator('[data-testid="task-add"]');
        const item=()=>page.locator('[data-testid="task-item"]').filter({hasText:title});
        await record(viewport+"-create",async()=>{
          await input.fill(title,{timeout:5000});
          await add.click({timeout:5000});
          await item().waitFor({state:"visible",timeout:8000});
          if(failures.length)throw Error("Browser JavaScript errors: "+failures.join("; "));
        });
        await record(viewport+"-reload",async()=>{
          await page.reload({waitUntil:"load"});
          await item().waitFor({state:"visible",timeout:8000});
          const overflow=await page.evaluate("document.documentElement.scrollWidth > innerWidth + 3");
          if(overflow)throw Error("The app overflows its viewport");
        });
        await record(viewport+"-delete",async()=>{
          await item().locator('[data-testid="task-delete"]').click({timeout:5000});
          await item().waitFor({state:"detached",timeout:8000});
        });
        await record(viewport+"-delete-reload",async()=>{
          await page.reload({waitUntil:"load"});
          await item().waitFor({state:"detached",timeout:5000});
          if(failures.length)throw Error("Browser JavaScript errors: "+failures.join("; "));
        });
      }finally{await context.close();}
    }
  }catch(error){
    if(!blockers.length)blockers.push(error instanceof Error?error.message:String(error));
  }finally{
    try{await browser?.close();}catch{}
    await stopTaskAppServer(child);
    try{fs.rmSync(storage,{force:true});}catch{}
  }
  return result();
}
