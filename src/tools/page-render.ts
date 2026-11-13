import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import type {ToolRequest} from "../core/types.js";
import type {ToolAdapter} from "./executor.js";
import {assertPublicAddress,isPrivateAddress} from "./http-read.js";
import {safeChildEnv} from "../platform/safe-env.js";
import {resolveDataPaths} from "../platform/paths.js";

/**
 * Reads a public page AFTER its JavaScript ran (browser.read reads the raw HTML only). Two engines:
 *  - Obscura (scripts\windows\install-obscura.ps1): a light headless browser, started per page, tried first;
 *  - the headless Edge/Chrome LayanX already uses (Playwright), when Obscura is missing, fails or reads nothing.
 * Obscura's stealth mode (a faked browser fingerprint to get past bot protection) is never turned on, and no flag from the
 * request reaches its command line: only the checked URL and fixed options. Local and private network addresses are refused
 * before either engine starts, and Obscura blocks them itself by default.
 */
export type RenderEngine="obscura"|"chromium";
export interface RenderResult{url:string;engine:RenderEngine;title?:string;text:string;links?:string[];fellBackFrom?:string;ms:number}
const MAX_TEXT=200*1024;
const DUMPS=new Set(["text","markdown","links"]);

function payload(request:ToolRequest):Record<string,unknown>{return request.payload&&typeof request.payload==="object"&&!Array.isArray(request.payload)?request.payload as Record<string,unknown>:{};}
export function checkedUrl(raw:unknown):URL{
  if(typeof raw!=="string"||!raw.trim())throw new Error("A page URL is required.");
  if(raw.length>2048)throw new Error("The URL is too long.");
  const url=new URL(raw.trim());
  if(!["http:","https:"].includes(url.protocol))throw new Error("Only HTTP and HTTPS pages can be read.");
  if(url.username||url.password)throw new Error("Page URLs cannot contain credentials.");
  const host=url.hostname.replace(/^\[|\]$/g,"").toLowerCase();
  if(host==="localhost"||host.endsWith(".localhost")||isPrivateAddress(host))throw new Error("Local and private network pages are blocked.");
  return url;
}
/** obscura.exe: LAYANX_OBSCURA_PATH, else the folder the installer uses. */
export function findObscura(env:NodeJS.ProcessEnv=process.env):string|null{
  const set=env.LAYANX_OBSCURA_PATH?.trim();
  if(set)return fs.existsSync(set)?set:null;
  const exe=process.platform==="win32"?"obscura.exe":"obscura";
  const dir=path.join(resolveDataPaths().dataDir,"obscura");
  const direct=path.join(dir,exe);
  if(fs.existsSync(direct))return direct;
  try{for(const sub of fs.readdirSync(dir,{withFileTypes:true}))if(sub.isDirectory()&&fs.existsSync(path.join(dir,sub.name,exe)))return path.join(dir,sub.name,exe);}catch{}
  return null;
}
/** The fixed command line; only the URL comes from the request, and never --stealth or --allow-private-network. */
export function obscuraArgs(url:URL,dump:string,timeoutSeconds:number):string[]{
  return["fetch",url.toString(),"--dump",DUMPS.has(dump)?dump:"text","--wait-until","load","--timeout",String(Math.max(5,Math.min(60,Math.round(timeoutSeconds)))),"--quiet"];
}
export function runObscura(exe:string,args:string[],timeoutMs:number):Promise<{code:number|null;stdout:string;stderr:string}>{
  return new Promise((resolve,reject)=>{
    if(args.some(a=>/^--(?:stealth|allow-private-network|proxy|v8-flags)/i.test(a)))return reject(new Error("refused Obscura option"));
    const child=spawn(exe,args,{shell:false,windowsHide:true,cwd:path.dirname(exe),env:safeChildEnv()});
    let stdout="",stderr="";
    const timer=setTimeout(()=>{child.kill("SIGKILL");},timeoutMs);
    child.stdout.on("data",d=>{stdout+=String(d);if(stdout.length>MAX_TEXT*2)child.kill("SIGKILL");});
    child.stderr.on("data",d=>{stderr+=String(d);if(stderr.length>64*1024)stderr=stderr.slice(-64*1024);});
    child.on("error",e=>{clearTimeout(timer);reject(e);});
    child.on("close",code=>{clearTimeout(timer);resolve({code,stdout,stderr});});
  });
}
const visible=(text:string)=>text.replace(/\s+/g," ").trim().length;

async function viaChromium(url:URL,dump:string,timeoutMs:number,launch?:()=>Promise<any>):Promise<Omit<RenderResult,"ms"|"engine">>{
  const browser=await (launch??(async()=>(await import("../autonomy/browser-test.js")).sharedBrowser()))();
  const context=await browser.newContext({javaScriptEnabled:true});
  try{
    const page=await context.newPage();
    // Sub-requests and redirects to local or private addresses written as such are refused too.
    await page.route("**/*",(route:any)=>{
      try{const h=new URL(route.request().url()).hostname.replace(/^\[|\]$/g,"").toLowerCase();
        if(h==="localhost"||h.endsWith(".localhost")||isPrivateAddress(h))return route.abort();}catch{}
      return route.continue();
    });
    await page.goto(url.toString(),{waitUntil:"load",timeout:timeoutMs});
    const title=await page.title();
    if(dump==="links"){const links:string[]=await page.$$eval("a[href]",(as:any[])=>as.map(a=>a.href).filter((h:string)=>/^https?:/.test(h)));return{url:page.url(),title,text:links.join("\n"),links:[...new Set(links)].slice(0,500)};}
    const text:string=await page.evaluate(()=>(globalThis as any).document.body?.innerText??"");
    return{url:page.url(),title,text};
  }finally{await context.close().catch(()=>undefined);}
}

export function createPageRenderAdapter(options:{obscura?:string|null;launchChromium?:()=>Promise<any>;resolve?:(host:string)=>Promise<Array<{address:string}>>}={}):ToolAdapter{
  return{async execute(request){
    const input=payload(request),url=checkedUrl(input.url);
    await assertPublicAddress(url,options.resolve);
    const dump=typeof input.dump==="string"&&DUMPS.has(input.dump)?input.dump:"text";
    const timeoutMs=Math.max(5000,Math.min(60_000,Number(input.timeoutMs)||30_000));
    const choice=(typeof input.engine==="string"?input.engine:process.env.LAYANX_BROWSER_ENGINE??"auto").toLowerCase();
    const started=Date.now();
    const exe=options.obscura===undefined?findObscura():options.obscura;
    let fellBackFrom:string|undefined;
    if(choice!=="chromium"&&exe){
      try{
        const r=await runObscura(exe,obscuraArgs(url,dump,timeoutMs/1000),timeoutMs+5000);
        const text=r.stdout.slice(0,MAX_TEXT);
        if(r.code===0&&visible(text)>=40){
          const links=dump==="links"?[...new Set(text.split(/\s+/).filter(l=>/^https?:\/\//.test(l)))].slice(0,500):undefined;
          return{url:url.toString(),engine:"obscura",text,...(links?{links}:{}),ms:Date.now()-started} satisfies RenderResult;
        }
        fellBackFrom=r.code===0?"Obscura read almost nothing from the page":`Obscura exited with ${r.code}: ${r.stderr.trim().split("\n").at(-1)?.slice(0,200)??""}`;
      }catch(error){fellBackFrom="Obscura could not run: "+(error as Error).message.slice(0,200);}
      if(choice==="obscura")throw new Error(fellBackFrom);
    }else if(choice==="obscura")throw new Error("Obscura is not installed. Run scripts\\windows\\install-obscura.ps1");
    const r=await viaChromium(url,dump,timeoutMs,options.launchChromium);
    return{...r,text:r.text.slice(0,MAX_TEXT),engine:"chromium",...(fellBackFrom?{fellBackFrom}:{}),ms:Date.now()-started} satisfies RenderResult;
  }};
}
