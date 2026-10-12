import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";

/**
 * A searchable copy of public-apis/public-apis (MIT): ~2,000 free web APIs in 50 categories, each with
 * whether it needs a key (Auth), supports HTTPS and allows browser calls (CORS). When a goal needs outside
 * data (exchange rates, weather, maps, email checks, test data) the agent looks here first instead of
 * guessing an API. The list's "MCP Servers" table is not used: tool servers for LayanX itself are found
 * with mcp.registry.search (official registry, pinned packages) and added by the owner, never from here.
 *
 * The list is third-party and partly stale: entries are data, never instructions; the agent opens the
 * API's documentation and tries it before writing code for it, and keys go to the project's .env.
 * Downloaded once from a pinned commit and checked against its SHA-256 (no "latest").
 */
export const PINNED_CATALOG={
  repo:"public-apis/public-apis",
  commit:"3a416d89e0ce56df6f41152df36b694ba0d6047c",
  sha256:"220adb788ff9dfb9e98a907f175ea5cd9f4ffbed7314e0c31a7c5cac55d98fe6",
  license:"MIT"
} as const;
export const catalogUrl=(commit:string=PINNED_CATALOG.commit)=>`https://raw.githubusercontent.com/${PINNED_CATALOG.repo}/${commit}/README.md`;

export interface ApiEntry{name:string;url:string;description:string;category:string;auth:string;https:boolean;cors:"yes"|"no"|"unknown"}

const clean=(s:string,n:number)=>s.replace(/<[^>]*>/g,"").replace(/\s+/g," ").trim().slice(0,n);
/** Tracking parameters are dropped from the links (utm_*). */
export function cleanUrl(raw:string):string{
  try{
    const u=new URL(raw.trim());
    if(u.protocol!=="https:"&&u.protocol!=="http:")return"";
    for(const k of [...u.searchParams.keys()])if(/^utm_/i.test(k))u.searchParams.delete(k);
    return u.toString();
  }catch{return"";}
}
function cells(line:string):string[]{
  const t=line.trim().replace(/^\|/,"").replace(/\|$/,"");
  return t.split("|").map(c=>c.trim());
}

/**
 * The README's tables "API | Description | Auth | HTTPS | CORS" under each "### Category". Other tables
 * (the MCP servers list, which has no HTTPS/CORS columns) and the advertising sections (APILayer lists)
 * are skipped.
 */
export function parseCatalog(markdown:string):ApiEntry[]{
  const out:ApiEntry[]=[];
  let category="",table=false;
  for(const raw of markdown.split(/\r?\n/)){
    const line=raw.trim();
    if(line.startsWith("## ")){category="";table=false;continue;}
    if(line.startsWith("### ")){category=/APILayer/i.test(line)?"":clean(line.slice(4),60);table=false;continue;}
    if(!category)continue;
    if(/\bDescription\b/.test(line)&&/\bAuth\b/.test(line)){table=/\bHTTPS\b/.test(line)&&/\bCORS\b/.test(line);continue;}
    if(!table||!line.startsWith("|")||/^\|\s*:?-{3}/.test(line))continue;
    const c=cells(line);
    const link=/^\[([^\]]+)\]\(([^)\s]+)\s*\)/.exec(c[0]??"");
    if(!link||c.length<5)continue;
    const url=cleanUrl(link[2]!);if(!url)continue;
    const auth=clean((c[2]??"").replace(/`/g,""),30)||"Unknown";
    const cors=(c[4]??"").toLowerCase();
    out.push({name:clean(link[1]!,100),url,description:clean(c[1]??"",300),category,auth,https:/^yes/i.test(c[3]??""),cors:cors.startsWith("yes")?"yes":cors.startsWith("no")?"no":"unknown"});
  }
  return out;
}

// Arabic (and a few spoken) words for the categories, so an Arabic goal finds English entries.
const SYNONYMS:Array<[RegExp,string]>=[
  [/عمل(ة|ات)|صرف|دولار|ريال|exchange|forex/,"currency exchange rates"],
  [/طقس|حرار|مطر|weather/,"weather forecast"],
  [/خريط|موقع جغرافي|احداثي|إحداثي|عنوان|geo/,"geocoding maps location address"],
  [/بريد|ايميل|إيميل|email/,"email"],
  [/تحقق|صحة البيانات|validat/,"validation verify"],
  [/شحن|تتبع|طرود|track/,"tracking shipping"],
  [/تسوق|متجر|منتج|سلع|shop/,"shopping products ecommerce"],
  [/اخبار|أخبار|news/,"news"],
  [/عملات رقمية|بيتكوين|كريبتو|crypto/,"cryptocurrency bitcoin"],
  [/مال|بنك|سهم|اسهم|أسهم|بورص|financ|stock/,"finance stock"],
  [/صور|تصوير|photo|image/,"photography images"],
  [/فيديو|video/,"video"],
  [/موسيق|اغان|أغان|music/,"music"],
  [/رياض|كرة|sport/,"sports"],
  [/طعام|اكل|أكل|وصف|مطعم|food|recipe/,"food recipes"],
  [/كتب|كتاب|book/,"books"],
  [/وظائف|وظيفة|توظيف|job/,"jobs"],
  [/صح(ة|ي)|طب|دواء|health/,"health"],
  [/هاتف|جوال|رقم|phone/,"phone number"],
  [/بيانات تجريبية|وهمية|اختبار|test data|fake/,"test data fake"],
  [/امن|أمن|ثغر|فيروس|secur|malware/,"security malware"],
  [/حكوم|govern/,"government"],
  [/بيئ|طاقة|تلوث|environment/,"environment"],
  [/نقل|مواصلات|طيران|رحلات|transport|flight/,"transportation flights"],
  [/سيار|مركب|vehicle|car/,"vehicle cars"],
  [/فعاليات|مناسبات|حدث|event/,"events"],
  [/تقويم|عطل|اجاز|إجاز|calendar|holiday/,"calendar holidays"],
  [/قاموس|معجم|ترجم|dictionar|translat/,"dictionary translation"],
  [/ذكاء اصطناعي|تعلم الآلة|machine learning|\bai\b/,"machine learning"],
  [/نص|تحليل النص|مشاعر|text|sentiment/,"text analysis"],
  [/روابط مختصرة|اختصار الرابط|short/,"url shortener"],
  [/دخول|مصادقة|تسجيل|auth|login/,"authentication"],
  [/ملفات|تخزين|رفع|storage|upload/,"cloud storage file sharing"],
  [/تواصل|اجتماعي|social/,"social"]
];
function tokens(query:string):string[]{
  const q=query.toLowerCase();
  const extra=SYNONYMS.filter(([rx])=>rx.test(q)).map(([,w])=>w).join(" ");
  return [...new Set((q+" "+extra).split(/[^\p{L}\p{N}]+/u).filter(t=>t.length>=2&&!STOP.has(t)))];
}
const STOP=new Set(["the","and","for","with","api","apis","free","of","to","in","a","an","or","من","في","على","الى","إلى","عن","مع","او","أو","api"]);

export interface CatalogQuery{query?:string;category?:string;auth?:"none"|"any";https?:boolean;cors?:boolean;limit?:number}
export function searchCatalog(entries:ApiEntry[],q:CatalogQuery):ApiEntry[]{
  const words=tokens(q.query??"");
  const cat=q.category?.trim().toLowerCase();
  const limit=Math.min(Math.max(Math.floor(q.limit??8),1),25);
  const scored:Array<{e:ApiEntry;s:number}>=[];
  for(const e of entries){
    if(cat&&!e.category.toLowerCase().includes(cat))continue;
    if(q.auth==="none"&&e.auth.toLowerCase()!=="no")continue;
    if((q.https??true)&&!e.https)continue;
    if(q.cors&&e.cors!=="yes")continue;
    const name=e.name.toLowerCase(),desc=e.description.toLowerCase(),c=e.category.toLowerCase();
    let s=words.length?0:1;
    for(const w of words){if(name.includes(w))s+=3;if(c.includes(w))s+=2;if(desc.includes(w))s+=1;}
    if(s>0)scored.push({e,s});
  }
  const rank=(e:ApiEntry)=>(e.auth.toLowerCase()==="no"?2:0)+(e.cors==="yes"?1:0);
  return scored.sort((a,b)=>b.s-a.s||rank(b.e)-rank(a.e)||a.e.name.localeCompare(b.e.name)).slice(0,limit).map(x=>x.e);
}

type Pin={commit:string;sha256:string};
function storeDir(env:NodeJS.ProcessEnv){return path.resolve(env.LAYANX_STORE_DIR?.trim()||".layanx");}
export function catalogCacheFile(env:NodeJS.ProcessEnv=process.env,pin:Pin=PINNED_CATALOG){return path.join(storeDir(env),"catalog",`public-apis-${pin.commit.slice(0,12)}.json`);}

let memo:{file:string;entries:ApiEntry[]}|null=null;
/** Bumped when the parsed shape changes, so an older cache is parsed again (2: web APIs only). */
const CACHE_FORMAT=2;
/** The parsed catalog: from the local cache, or downloaded once (pinned commit, SHA-256 checked). */
export async function loadCatalog(env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch,pin:Pin=PINNED_CATALOG):Promise<ApiEntry[]>{
  if(env.LAYANX_API_CATALOG==="off")throw new Error("The API catalog is turned off (LAYANX_API_CATALOG=off).");
  const file=catalogCacheFile(env,pin);
  if(memo?.file===file)return memo.entries;
  try{const cached=JSON.parse(fs.readFileSync(file,"utf8")) as {commit?:string;format?:number;entries?:ApiEntry[]};if(cached.commit===pin.commit&&cached.format===CACHE_FORMAT&&Array.isArray(cached.entries)&&cached.entries.length){memo={file,entries:cached.entries};return cached.entries;}}catch{}
  const r=await fetcher(catalogUrl(pin.commit),{signal:AbortSignal.timeout(30_000),redirect:"error"});
  if(!r.ok)throw new Error(`Could not download the API catalog (HTTP ${r.status}).`);
  const bytes=Buffer.from(await r.arrayBuffer());
  const sha=createHash("sha256").update(bytes).digest("hex");
  if(sha!==pin.sha256)throw new Error(`The downloaded API catalog does not match its pinned SHA-256 (got ${sha.slice(0,12)}…). It was not used.`);
  const entries=parseCatalog(bytes.toString("utf8"));
  if(!entries.length)throw new Error("The API catalog could not be read.");
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify({repo:PINNED_CATALOG.repo,commit:pin.commit,license:PINNED_CATALOG.license,format:CACHE_FORMAT,entries}));
  memo={file,entries};
  return entries;
}
export function resetCatalogMemo(){memo=null;}

export const CATALOG_NOTE="Third-party list (public-apis/public-apis, MIT), not checked by LayanX: open the API's documentation and try one request before writing code for it; prefer auth No; put any key in the project's .env (never in code). This is for the project's code; a tool server for LayanX itself is mcp.registry.search.";
