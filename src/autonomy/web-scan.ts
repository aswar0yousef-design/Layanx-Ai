import {execFile} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {SecurityFinding,Severity} from "./security-scan.js";
import {pinnedImage} from "./external-agents.js";
import {dockerVersion} from "./sandbox.js";

/**
 * Baseline security scan of a running web app on THIS computer (the dev server LayanX started),
 * modelled on OWASP ZAP's baseline scan: crawl a few same-origin pages and check every response
 * passively. Requests are ordinary GETs; nothing is attacked. Only loopback addresses are scanned.
 *
 * Optional: the real ZAP baseline in Docker (pinned image), when Docker runs and LAYANX_ZAP allows it:
 *   LAYANX_ZAP=auto (default) use ZAP only if its image is already downloaded
 *   LAYANX_ZAP=on   download the image once if needed (about 1.5 GB)
 *   LAYANX_ZAP=off  never
 * Rule ids carry ZAP's plugin id where one exists, so ZAP's duplicates are dropped.
 */
export const DEFAULT_ZAP_IMAGE="ghcr.io/zaproxy/zaproxy:2.17.0";
export interface WebScanResult{url:string;pages:string[];findings:SecurityFinding[];missing:string[];zap?:{ran:boolean;alerts:number;note?:string;image?:string}}
type Fetcher=typeof fetch;

export function isLoopbackUrl(raw:string):boolean{
  try{const u=new URL(raw);if(u.protocol!=="http:"&&u.protocol!=="https:")return false;
    const h=u.hostname.replace(/^\[|\]$/g,"").toLowerCase();
    return h==="localhost"||h==="::1"||/^127(\.\d{1,3}){3}$/.test(h);}catch{return false;}
}

interface Seen{url:string;status:number;headers:Headers;body:string;html:boolean}
const SESSION_COOKIE=/sess|sid\b|token|auth|jwt|login|remember/i;
const ERROR_LEAK:RegExp[]=[/\bat [\w$.<>]+ \((?:[A-Za-z]:)?[\\/][^)]+:\d+:\d+\)/,/Traceback \(most recent call last\)/,/\bSQLSTATE\[/,/Microsoft \.NET Framework Version/,/(?:Warning|Fatal error): .* in \/.+ on line \d+/,/\bjava\.lang\.\w+Exception\b/];

export class Collector{
  private map=new Map<string,SecurityFinding&{urls:string[]}>();
  add(rule:string,severity:Severity,message:string,fix:string,url:string){
    const f=this.map.get(rule);
    if(f){if(f.urls.length<5&&!f.urls.includes(url))f.urls.push(url);return;}
    this.map.set(rule,{severity,rule,message,fix,file:url,urls:[url]});
  }
  list():SecurityFinding[]{return[...this.map.values()].map(({urls,...f})=>({...f,message:urls.length>1?`${f.message} (${urls.length}+ URLs)`:f.message}));}
  has(rule:string){return this.map.has(rule);}
}

function links(html:string,base:string):string[]{
  const out:string[]=[];
  for(const m of html.matchAll(/\b(?:href|src|action)\s*=\s*["']([^"'#]+)["']/gi)){
    try{const u=new URL(m[1]!,base);if(u.protocol==="http:"||u.protocol==="https:"){u.hash="";out.push(u.toString());}}catch{}
  }
  return out;
}

/** Passive checks on one response (headers, cookies, body). Exported for tests. */
export function checkResponse(r:Seen,origin:string,c:Collector){
  const h=(n:string)=>r.headers.get(n);
  const https=r.url.startsWith("https:");
  const csp=h("content-security-policy")??"";
  if(r.html){
    if(!csp)c.add("zap.10038","medium","Content-Security-Policy header not set","Send a Content-Security-Policy (start with default-src 'self'; add only the sources the app needs).",r.url);
    else{
      const script=/(?:^|;)\s*script-src\s+([^;]*)/i.exec(csp)?.[1]??/(?:^|;)\s*default-src\s+([^;]*)/i.exec(csp)?.[1]??"";
      if(/'unsafe-eval'/.test(script))c.add("zap.10055.eval","medium","CSP allows 'unsafe-eval'","Remove 'unsafe-eval' from script-src; avoid eval/new Function in the app.",r.url);
      if(/'unsafe-inline'/.test(script)&&!/'nonce-|'sha(256|384|512)-|'strict-dynamic'/.test(script))c.add("zap.10055.inline","low","CSP allows inline scripts","Use nonces or hashes instead of 'unsafe-inline' in script-src.",r.url);
      if(/(^|\s)\*(\s|$)|(^|\s)(https?:|data:)(\s|$)/.test(script))c.add("zap.10055.wildcard","medium","CSP allows scripts from any host","List exact script origins instead of *, http: or data:.",r.url);
    }
    if(!h("x-frame-options")&&!/frame-ancestors/i.test(csp))c.add("zap.10020","low","No protection against clickjacking (X-Frame-Options or CSP frame-ancestors)","Send X-Frame-Options: DENY or CSP frame-ancestors 'none'.",r.url);
    if(!h("referrer-policy"))c.add("headers.referrer-policy","low","Referrer-Policy header not set","Send Referrer-Policy: strict-origin-when-cross-origin.",r.url);
    if(https)for(const m of r.body.matchAll(/<(?:script|link|img|iframe)[^>]+(?:src|href)\s*=\s*["'](http:\/\/[^"']+)["']/gi))c.add("zap.10040","medium","HTTPS page loads content over plain HTTP (mixed content)","Load every resource over https://.",r.url+" -> "+m[1]);
    for(const m of r.body.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi)){
      try{const src=new URL(m[1]!,r.url);if(src.origin!==origin&&!/\bintegrity\s*=/.test(m[0]))c.add("zap.90003","low","Script from another site loaded without Subresource Integrity","Add integrity=\"sha384-...\" and crossorigin=\"anonymous\" to third-party <script> tags, or self-host the file.",r.url+" -> "+src.toString());}catch{}
    }
    if(/<title>\s*(Index of \/|Directory listing for)/i.test(r.body))c.add("web.directory-listing","medium","The server lists a directory's files","Turn off directory listing in the web server.",r.url);
  }
  if(h("x-content-type-options")?.toLowerCase()!=="nosniff")c.add("zap.10021","low","X-Content-Type-Options: nosniff missing","Send X-Content-Type-Options: nosniff on every response.",r.url);
  if(https&&!h("strict-transport-security"))c.add("zap.10035","medium","Strict-Transport-Security header not set","Send Strict-Transport-Security: max-age=31536000; includeSubDomains on HTTPS.",r.url);
  const server=h("server");if(server&&/\d/.test(server))c.add("zap.10036","low",`Server header reveals its version (${server.slice(0,40)})`,"Hide the version in the Server header (for example server_tokens off).",r.url);
  const powered=h("x-powered-by");if(powered)c.add("zap.10037","low",`X-Powered-By header reveals the framework (${powered.slice(0,40)})`,"Remove X-Powered-By (Express: app.disable('x-powered-by') or helmet).",r.url);
  const cookies=typeof r.headers.getSetCookie==="function"?r.headers.getSetCookie():(h("set-cookie")?[h("set-cookie")!]:[]);
  for(const ck of cookies){
    const name=ck.split("=")[0]!.trim();
    if(!/;\s*httponly/i.test(ck))c.add("zap.10010",SESSION_COOKIE.test(name)?"medium":"low",`Cookie "${name}" can be read by JavaScript (no HttpOnly)`,"Set HttpOnly on cookies the browser scripts do not need, always on session cookies.",r.url);
    if(https&&!/;\s*secure/i.test(ck))c.add("zap.10011","low",`Cookie "${name}" without Secure`,"Set Secure so the cookie never travels over plain HTTP.",r.url);
    if(!/;\s*samesite=/i.test(ck))c.add("zap.10054","low",`Cookie "${name}" without SameSite`,"Set SameSite=Lax (or Strict) to limit cross-site requests.",r.url);
  }
  if(r.status>=400||r.html)for(const rx of ERROR_LEAK)if(rx.test(r.body)){c.add("zap.90022","medium","The app shows internal error details (stack trace / SQL error)","Show a generic error page; log details on the server only.",r.url);break;}
}

async function get(fetcher:Fetcher,url:string,headers:Record<string,string>={}):Promise<Seen|null>{
  try{
    const res=await fetcher(url,{redirect:"manual",headers:{"user-agent":"LayanX-baseline/1",...headers},signal:AbortSignal.timeout(8000)});
    const type=res.headers.get("content-type")??"";
    const text=/text|json|javascript|xml/.test(type)||!type?(await res.text()).slice(0,400_000):"";
    return{url,status:res.status,headers:res.headers,body:text,html:/text\/html/.test(type)};
  }catch{return null;}
}

/** Crawl up to `maxPages` same-origin pages and run the passive checks; then probe a few well-known leaks. */
export async function webBaseline(startUrl:string,opts:{maxPages?:number;fetcher?:Fetcher;env?:NodeJS.ProcessEnv;zap?:boolean}={}):Promise<WebScanResult>{
  if(!isLoopbackUrl(startUrl))throw new Error("The web scan only checks apps running on this computer (localhost / 127.0.0.1).");
  const fetcher=opts.fetcher??fetch;const env=opts.env??process.env;
  const origin=new URL(startUrl).origin;const c=new Collector();
  const queue=[startUrl],done=new Set<string>(),pages:string[]=[];
  const maxPages=opts.maxPages??20;
  while(queue.length&&pages.length<maxPages){
    const url=queue.shift()!;if(done.has(url))continue;done.add(url);
    const r=await get(fetcher,url);if(!r)continue;
    pages.push(url);checkResponse(r,origin,c);
    if(r.status>=300&&r.status<400){const loc=r.headers.get("location");if(loc)try{const u=new URL(loc,url);if(u.origin===origin)queue.push(u.toString());}catch{}}
    if(r.html)for(const l of links(r.body,url))if(new URL(l).origin===origin&&!done.has(l)&&!/\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|mp4|webm|pdf|zip)(\?|$)/i.test(l))queue.push(l);
  }
  // CORS: does the app trust any Origin?
  const probe=await get(fetcher,startUrl,{origin:"http://evil.example"});
  if(probe){
    const acao=probe.headers.get("access-control-allow-origin"),creds=probe.headers.get("access-control-allow-credentials")==="true";
    if(acao==="http://evil.example")c.add("zap.10098",creds?"high":"medium","The app accepts requests from any website (CORS reflects the Origin"+(creds?" with credentials)":")"),"Allow only your own origins in the CORS configuration.",startUrl);
    else if(acao==="*"&&creds)c.add("zap.10098","high","CORS allows every origin with credentials","Never combine Access-Control-Allow-Origin: * with credentials; list exact origins.",startUrl);
  }
  // Files that must never be served.
  for(const [p,rx,what] of [["/.env",/^\s*[A-Z_][A-Z0-9_]*\s*=/m,"the .env file (secrets)"],["/.git/HEAD",/^ref: refs\//,"the .git folder (full source history)"],["/.git/config",/\[core\]/,"the .git folder (full source history)"]] as const){
    const r=await get(fetcher,origin+p);
    if(r&&r.status===200&&rx.test(r.body))c.add("web.exposed"+p.replace(/[/.]/g,"-"),"high",`The server publishes ${what} at ${p}`,"Serve only the build output folder; block dot-files in the web server.",origin+p);
  }
  let findings=c.list();
  const missing=findings.filter(f=>/^(zap\.(10038|10020|10021|10035)|headers\.)/.test(f.rule)).map(f=>({"zap.10038":"Content-Security-Policy","zap.10020":"Frame-Protection","zap.10021":"X-Content-Type-Options","zap.10035":"Strict-Transport-Security","headers.referrer-policy":"Referrer-Policy"} as Record<string,string>)[f.rule]!).filter(Boolean);
  let zap:WebScanResult["zap"];
  if(opts.zap!==false){
    const z=await zapBaseline(startUrl,env);
    if(z.ran&&z.findings){
      const have=new Set(findings.map(f=>f.rule.split(".").slice(0,2).join(".")));
      findings=[...findings,...z.findings.filter(f=>!have.has(f.rule))];
    }
    zap={ran:z.ran,alerts:z.findings?.length??0,...(z.note?{note:z.note}:{}),...(z.image?{image:z.image}:{})};
  }
  return{url:startUrl,pages,findings,missing,...(zap?{zap}:{})};
}

// ---------------------------------------------------------------- real ZAP (Docker, optional)
const RISK:Record<string,Severity>={"3":"high","2":"medium","1":"low","0":"info"};
const stripHtml=(s:unknown)=>String(s??"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
/** ZAP "traditional JSON" report -> findings. Exported for tests. */
export function parseZapReport(json:string):SecurityFinding[]{
  const data=JSON.parse(json) as {site?:Array<{alerts?:Array<Record<string,unknown>>}>};
  const out:SecurityFinding[]=[];
  for(const site of data.site??[])for(const a of site.alerts??[]){
    const inst=(a.instances as Array<{uri?:string}>|undefined)??[];
    out.push({severity:RISK[String(a.riskcode)]??"info",rule:"zap."+String(a.pluginid),message:`ZAP: ${stripHtml(a.name??a.alert)}${inst.length>1?` (${inst.length} URLs)`:""}`,
      fix:stripHtml(a.solution).slice(0,300)||"See the ZAP alert details.",...(inst[0]?.uri?{file:inst[0].uri}:{})});
  }
  return out;
}
function run(cmd:string,args:string[],timeout:number):Promise<{code:number;out:string}>{
  return new Promise(res=>execFile(cmd,args,{windowsHide:true,timeout,maxBuffer:16*1024*1024},(err,so,se)=>res({code:err?(typeof (err as {code?:unknown}).code==="number"?(err as {code:number}).code:1):0,out:String(so)+String(se)})));
}
/** docker argv for the ZAP baseline. Exported for tests. */
export function zapDockerArgs(target:string,workDir:string,image:string,platform:NodeJS.Platform=process.platform):string[]{
  // Linux: share the host network so 127.0.0.1 is the app. Docker Desktop: host.docker.internal is this PC.
  const u=new URL(target);
  let network:string[];
  // Docker Desktop: dev servers (Vite, webpack) refuse unknown Host headers, so ZAP sends the original
  // localhost Host while connecting to host.docker.internal.
  let replacer:string[]=[];
  if(platform==="linux")network=["--network","host"];
  else{
    network=["--add-host","host.docker.internal:host-gateway"];
    const original=u.host;u.hostname="host.docker.internal";
    const r="replacer.full_list(0)";
    replacer=["-z",[`-config ${r}.description=localhost-host`,`-config ${r}.enabled=true`,`-config ${r}.matchtype=REQ_HEADER`,`-config ${r}.matchstr=Host`,`-config ${r}.regex=false`,`-config ${r}.replacement=${original}`].join(" ")];
  }
  return["run","--rm",...network,"--mount",`type=bind,source=${workDir},target=/zap/wrk`,image,"zap-baseline.py","-t",u.toString(),"-J","zap.json","-m","1","-T","5","-I",...replacer];
}
export async function zapBaseline(url:string,env:NodeJS.ProcessEnv=process.env):Promise<{ran:boolean;findings?:SecurityFinding[];note?:string;image?:string}>{
  const mode=(env.LAYANX_ZAP??"auto").toLowerCase();
  if(mode==="off")return{ran:false,note:"switched off (LAYANX_ZAP=off)"};
  const image=env.LAYANX_ZAP_IMAGE?.trim()||DEFAULT_ZAP_IMAGE;
  if(!pinnedImage(image))return{ran:false,note:"LAYANX_ZAP_IMAGE must name an exact version or digest"};
  if(!dockerVersion())return{ran:false,note:"Docker is not running (built-in checks only)"};
  const present=(await run("docker",["image","inspect","--format","{{.Id}}",image],20_000)).code===0;
  if(!present){
    if(mode!=="on")return{ran:false,note:`ZAP image not downloaded; set LAYANX_ZAP=on to use ${image}`,image};
    const pull=await run("docker",["pull",image],30*60_000);
    if(pull.code!==0)return{ran:false,note:"docker pull failed: "+pull.out.slice(-300),image};
  }
  const work=fs.mkdtempSync(path.join(os.tmpdir(),"lx-zap-"));
  try{
    try{fs.chmodSync(work,0o777);}catch{}
    const r=await run("docker",zapDockerArgs(url,work,image),15*60_000);
    const report=path.join(work,"zap.json");
    if(!fs.existsSync(report))return{ran:false,note:`ZAP did not write a report (exit ${r.code}): ${r.out.slice(-300)}`,image};
    return{ran:true,findings:parseZapReport(fs.readFileSync(report,"utf8")),image};
  }finally{fs.rmSync(work,{recursive:true,force:true});}
}
