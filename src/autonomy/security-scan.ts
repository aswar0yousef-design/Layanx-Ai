import fs from "node:fs";
import path from "node:path";
import type {ToolAdapter} from "../tools/executor.js";
import type {ToolRequest} from "../core/types.js";
import {detectProject,commandFor,runOnce} from "./project-runner.js";
import {projectDir} from "./project-dir.js";
import {runExternalScanners} from "./external-scanners.js";
import {updateHealth} from "./knowledge.js";

/**
 * project.security: security check for websites and apps LayanX builds (offline rules, no extra tools).
 *  - code: hard-coded secrets, eval, command / SQL injection, XSS sinks, disabled TLS checks,
 *          wildcard CORS, insecure cookies, literal JWT secrets, weak hashing, debug mode, .env committed
 *  - dependencies: npm audit (needs package-lock.json and internet)
 *  - running app: security headers of the dev server (CSP, nosniff, frame protection, referrer, HSTS)
 * Score 0-100. Any critical/high finding outside tests BLOCKS "done" in the supervisor.
 * Silence a reviewed line with a trailing comment: layanx-ignore-security
 */
export type Severity="critical"|"high"|"medium"|"low"|"info";
export interface SecurityFinding{severity:Severity;rule:string;message:string;file?:string;line?:number;fix:string;test?:boolean}
export interface SecurityReport{score:number;blocked:boolean;counts:Record<Severity,number>;findings:SecurityFinding[];scannedFiles:number;audit?:{ran:boolean;note?:string};headers?:{url:string;missing:string[]};scanners?:Array<{tool:string;ran:boolean;findings:number;note?:string}>;at:string}

const SKIP_DIRS=new Set(["node_modules",".git","dist","build",".next","out","coverage",".layanx","vendor","__pycache__",".venv","venv","target","bin","obj",".dart_tool"]);
const SCAN_EXT=new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".vue",".svelte",".py",".php",".rb",".go",".cs",".java",".dart",".html",".env",".json",".yml",".yaml",".toml",".ini",".cfg"]);
interface Rule{id:string;severity:Severity;rx:RegExp;ext?:RegExp;message:string;fix:string;keepInTests?:boolean}
const RULES:Rule[]=[
  {id:"secret.private-key",severity:"critical",rx:/-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/,message:"Private key in the source code",fix:"Remove it, rotate the key, load it from a secret store or environment variable.",keepInTests:true},
  {id:"secret.cloud-key",severity:"critical",rx:/\b(AKIA[0-9A-Z]{16}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[bpa]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{35}|sk_live_[0-9A-Za-z]{20,})\b/,message:"Real-looking API key or token committed",fix:"Revoke it at the provider, then read it from an environment variable.",keepInTests:true},
  {id:"secret.literal",severity:"high",rx:/\b(api[_-]?key|secret|password|passwd|token|auth[_-]?key)\b\s*[:=]\s*["'`][^"'`\s]{10,}["'`]/i,ext:/\.(ts|tsx|js|jsx|mjs|cjs|py|php|rb|go|cs|java|dart|json|yml|yaml)$/,message:"Hard-coded credential",fix:"Move it to an environment variable or secret store; never commit it."},
  {id:"code.eval",severity:"high",rx:/\beval\s*\(|new\s+Function\s*\(/,ext:/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte|html)$/,message:"Dynamic code execution (eval / new Function)",fix:"Parse data with JSON.parse or use a lookup table instead of executing strings."},
  {id:"code.command-injection",severity:"high",rx:/\b(exec|execSync|spawnSync|spawn)\s*\(\s*(`[^`]*\$\{|["'][^"']*["']\s*\+)|shell\s*:\s*true|os\.system\s*\(|subprocess\.\w+\([^)]*shell\s*=\s*True/,message:"Shell command built from variables",fix:"Use execFile/spawn with an argument array and shell:false; validate inputs."},
  {id:"code.sql-injection",severity:"high",rx:/\b(query|execute|raw|exec)\s*\(\s*(`\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b[^`]*\$\{|["'`]\s*(SELECT|INSERT|UPDATE|DELETE)\b[^"'`]*["'`]\s*\+)|f["'](SELECT|INSERT|UPDATE|DELETE)\b[^"']*\{/i,message:"SQL built by string concatenation",fix:"Use parameterised queries (placeholders) or the ORM's query builder."},
  {id:"web.xss-sink",severity:"medium",rx:/\.innerHTML\s*=\s*(?!["'`]\s*["'`]\s*;?$)[^;]*[a-zA-Z_$]|dangerouslySetInnerHTML|document\.write\s*\(|v-html\s*=/,ext:/\.(ts|tsx|js|jsx|mjs|vue|svelte|html)$/,message:"HTML inserted without escaping (XSS risk)",fix:"Use textContent / framework bindings, or sanitise with DOMPurify."},
  {id:"tls.disabled",severity:"high",rx:/rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|verify\s*=\s*False|InsecureSkipVerify\s*:\s*true/,message:"TLS certificate checks disabled",fix:"Keep certificate verification on; fix the certificate instead."},
  {id:"web.cors-wildcard",severity:"medium",rx:/origin\s*:\s*["']\*["']|Access-Control-Allow-Origin["']?\s*[:,]\s*["']\*["']|CORS_ALLOW_ALL_ORIGINS\s*=\s*True/,message:"CORS allows every origin",fix:"List the exact origins that may call the API."},
  {id:"web.cookie-flags",severity:"medium",rx:/\.cookie\s*\(\s*["'][^"']+["']\s*,[^)]*\)(?![^\n]*httpOnly)/,ext:/\.(ts|js|mjs|cjs)$/,message:"Cookie set without httpOnly",fix:"Set httpOnly, secure and sameSite on session cookies."},
  {id:"auth.jwt-literal",severity:"high",rx:/jwt\.sign\s*\([^,]+,\s*["'`][^"'`]+["'`]/,message:"JWT signed with a literal secret",fix:"Load the signing secret from the environment; use a long random value."},
  {id:"crypto.weak-hash",severity:"medium",rx:/createHash\s*\(\s*["'](md5|sha1)["']\s*\)|hashlib\.(md5|sha1)\s*\(/i,message:"MD5/SHA-1 used (weak for passwords and signatures)",fix:"Use bcrypt/argon2 for passwords and SHA-256+ for integrity."},
  {id:"crypto.random-token",severity:"low",rx:/Math\.random\s*\(\s*\)[^;\n]*(token|secret|password|otp|session|id\b)/i,message:"Math.random used for something secret",fix:"Use crypto.randomUUID() or crypto.getRandomValues()."},
  {id:"config.debug",severity:"medium",rx:/^\s*DEBUG\s*=\s*True\b|app\.run\([^)]*debug\s*=\s*True|app\.debug\s*=\s*True/,ext:/\.py$/,message:"Debug mode enabled",fix:"Read DEBUG from the environment and keep it off in production."},
  {id:"web.mixed-content",severity:"low",rx:/["'`]http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|schemas\.|www\.w3\.org|json-schema)[^"'`\s]+["'`]/,ext:/\.(ts|tsx|js|jsx|mjs|vue|svelte|html|py|php)$/,message:"Plain http:// URL in the code",fix:"Use https:// for every external resource."}
];

function walk(dir:string,out:string[],depth=0){
  if(out.length>4000||depth>12)return;
  let entries:fs.Dirent[]=[];try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}
  for(const e of entries){
    const p=path.join(dir,e.name);
    if(e.isDirectory()){if(!SKIP_DIRS.has(e.name)&&!(e.name.startsWith(".")&&e.name!==".github"))walk(p,out,depth+1);}
    else if(e.isFile()&&(SCAN_EXT.has(path.extname(e.name).toLowerCase())||e.name.startsWith(".env"))&&!e.name.endsWith(".min.js")&&e.name!=="package-lock.json")out.push(p);
  }
}
const isTest=(rel:string)=>/(^|\/)(tests?|__tests__|spec|fixtures?|mocks?)\/|\.(test|spec)\.\w+$|_test\.\w+$/.test(rel);

export function scanCode(dir:string):{findings:SecurityFinding[];scanned:number}{
  const files:string[]=[];walk(dir,files);
  const findings:SecurityFinding[]=[];
  for(const abs of files){
    let text="";try{const st=fs.statSync(abs);if(st.size>500_000)continue;text=fs.readFileSync(abs,"utf8");}catch{continue;}
    const rel=path.relative(dir,abs).split(path.sep).join("/");const test=isTest(rel);
    if(/\.env(\.|$)/.test(path.basename(rel))&&!/\.(example|sample|template)$/.test(rel))continue; // handled by the .env rule
    const lines=text.split("\n");
    for(let i=0;i<lines.length&&i<20000;i++){
      const line=lines[i]!;if(line.length>2000||line.includes("layanx-ignore-security"))continue;
      for(const r of RULES){
        if(r.ext&&!r.ext.test(rel))continue;
        if(!r.rx.test(line))continue;
        if(test&&!r.keepInTests)continue;
        findings.push({severity:test&&r.severity!=="critical"?"info":r.severity,rule:r.id,message:r.message,file:rel,line:i+1,fix:r.fix,...(test?{test:true}:{})});
        if(findings.length>300)return{findings,scanned:files.length};
      }
    }
  }
  // .env committed / not ignored
  const ignore=(()=>{try{return fs.readFileSync(path.join(dir,".gitignore"),"utf8");}catch{return"";}})();
  for(const name of [".env",".env.local",".env.production"])if(fs.existsSync(path.join(dir,name))&&!/^\s*\.env(\*|\.\*|\s|$)/m.test(ignore))
    findings.push({severity:"high",rule:"secret.env-not-ignored",message:`${name} exists and is not in .gitignore`,file:name,fix:"Add .env* to .gitignore and keep a .env.example without real values."});
  // express without security headers
  try{
    const pkg=JSON.parse(fs.readFileSync(path.join(dir,"package.json"),"utf8")) as {dependencies?:Record<string,string>};
    const deps=pkg.dependencies??{};
    if(deps.express&&!deps.helmet)findings.push({severity:"low",rule:"web.no-helmet",message:"Express app without helmet (security headers)",fix:"npm install helmet and app.use(helmet())."});
    if(deps.express&&!deps["express-rate-limit"]&&!deps["rate-limiter-flexible"])findings.push({severity:"low",rule:"web.no-rate-limit",message:"No rate limiting dependency for the Express API",fix:"Limit login and API routes, e.g. express-rate-limit."});
  }catch{}
  return{findings,scanned:files.length};
}

async function auditDependencies(dir:string):Promise<{findings:SecurityFinding[];ran:boolean;note?:string}>{
  const info=detectProject(dir);
  if(info.stack!=="node")return{findings:[],ran:false,note:"dependency audit available for Node projects"};
  if(!fs.existsSync(path.join(dir,"package-lock.json")))return{findings:[],ran:false,note:"no package-lock.json (run install first)"};
  const npm=commandFor({...info,scripts:[...info.scripts,"__audit__"]},"install");
  const r=await runOnce({command:npm.command,args:[...npm.args.slice(0,npm.args.length-3),"audit","--json","--omit=dev"],label:"npm audit"},dir,120_000);
  try{
    const data=JSON.parse(r.stdout) as {vulnerabilities?:Record<string,{severity?:string;via?:unknown[];fixAvailable?:unknown}>};
    const f:SecurityFinding[]=[];
    for(const [name,v] of Object.entries(data.vulnerabilities??{})){
      const sev=(v.severity==="moderate"?"medium":v.severity) as Severity;
      if(!["critical","high","medium","low"].includes(sev))continue;
      f.push({severity:sev,rule:"deps.vulnerable",message:`Vulnerable dependency: ${name}`,fix:v.fixAvailable?"Run npm audit fix (or update the package).":"Replace or update the package; no automatic fix."});
    }
    return{findings:f.slice(0,50),ran:true};
  }catch{return{findings:[],ran:false,note:"npm audit did not return a report (offline?)"};}
}

async function checkHeaders(url:string):Promise<{missing:string[];findings:SecurityFinding[]}>{
  try{
    const r=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:"manual"});
    const h=(n:string)=>r.headers.get(n);
    const missing:string[]=[];const findings:SecurityFinding[]=[];
    const need=(name:string,ok:boolean,sev:Severity,fix:string)=>{if(!ok){missing.push(name);findings.push({severity:sev,rule:"headers."+name.toLowerCase(),message:`Missing ${name} header`,fix});}};
    need("Content-Security-Policy",Boolean(h("content-security-policy")),"medium","Send a Content-Security-Policy (start with default-src 'self').");
    need("X-Content-Type-Options",h("x-content-type-options")==="nosniff","low","Send X-Content-Type-Options: nosniff.");
    need("Frame-Protection",Boolean(h("x-frame-options"))||/frame-ancestors/.test(h("content-security-policy")??""),"low","Send X-Frame-Options: DENY or CSP frame-ancestors 'none'.");
    need("Referrer-Policy",Boolean(h("referrer-policy")),"low","Send Referrer-Policy: strict-origin-when-cross-origin.");
    if(url.startsWith("https:"))need("Strict-Transport-Security",Boolean(h("strict-transport-security")),"medium","Send Strict-Transport-Security on HTTPS.");
    return{missing,findings};
  }catch{return{missing:[],findings:[]};}
}

export async function securityReport(dir:string,opts:{audit?:boolean;url?:string;external?:boolean}={}):Promise<SecurityReport>{
  const code=scanCode(dir);
  const audit=opts.audit===false?{findings:[],ran:false,note:"skipped"}:await auditDependencies(dir);
  const headers=opts.url?await checkHeaders(opts.url):null;
  const external=opts.external===false?[]:await runExternalScanners(dir);
  // npm audit and osv-scanner both report vulnerable npm packages: keep one finding per package.
  const seen=new Set(audit.findings.map(f=>f.message.replace(/^Vulnerable dependency: /,"").split(" ")[0]));
  const extra=external.flatMap(r=>r.findings).filter(f=>f.rule!=="deps.vulnerable"||!seen.has(f.message.replace(/^Vulnerable dependency: /,"").split(" ")[0]));
  const findings=[...code.findings,...audit.findings,...extra,...(headers?.findings??[])];
  const counts:Record<Severity,number>={critical:0,high:0,medium:0,low:0,info:0};
  for(const f of findings)counts[f.severity]++;
  const score=Math.max(0,100-counts.critical*30-counts.high*15-counts.medium*5-counts.low);
  const report:SecurityReport={score,blocked:counts.critical+counts.high>0,counts,findings,scannedFiles:code.scanned,audit:{ran:audit.ran,...(audit.note?{note:audit.note}:{})},...(headers&&opts.url?{headers:{url:opts.url,missing:headers.missing}}:{}),scanners:external.map(r=>({tool:r.tool,ran:r.ran,findings:r.findings.length,...(r.note?{note:r.note}:{})})),at:new Date().toISOString()};
  try{fs.mkdirSync(path.join(dir,".layanx"),{recursive:true});fs.writeFileSync(path.join(dir,".layanx","security.json"),JSON.stringify(report,null,1));}catch{}
  updateHealth(dir,"security",{ok:!report.blocked,score,summary:`${counts.critical} critical, ${counts.high} high, ${counts.medium} medium, ${counts.low} low`});
  return report;
}

export function createSecurityScanAdapter():ToolAdapter{
  return{async execute(request:ToolRequest){
    const input=(request.payload&&typeof request.payload==="object"?request.payload:{}) as Record<string,unknown>;
    const url=typeof input.url==="string"&&/^https?:\/\//.test(input.url)?input.url:undefined;
    const report=await securityReport(projectDir(request.projectId),{audit:input.audit!==false,...(url?{url}:{})});
    return{...report,ok:!report.blocked,findings:report.findings.slice(0,80)};
  }};
}
