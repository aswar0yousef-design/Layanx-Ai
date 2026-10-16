import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolAdapter} from "../tools/executor.js";
import {projectDir} from "../autonomy/project-dir.js";
import {isPathInside} from "../platform/path-guard.js";

/**
 * Vercel through its REST API with the owner's token (VERCEL_TOKEN, read at call time from the
 * secret store, never put in a file, a command line or a child process).
 *
 *   vercel.projects.list     read   projects, their domains and latest production URL
 *   vercel.deployments.list  read   recent deployments; with deploymentId: state, URL and the build log tail
 *   vercel.deploy            preview deploy of the project folder (Vercel builds it); never production
 *   vercel.promote           production: points the project's domains at a ready deployment (owner approval)
 *
 * Files never uploaded: .env*, keys and certificates, .git, node_modules, .vercel, .layanx, and
 * whatever .vercelignore lists.
 */
const API="https://api.vercel.com";
export const VERCEL_TOOLS=["vercel.projects.list","vercel.deployments.list","vercel.deploy","vercel.promote"] as const;
const MAX_FILES=10_000,MAX_BYTES=200*1024*1024;
const ALWAYS_SKIP_DIRS=new Set([".git","node_modules",".vercel",".layanx",".next",".turbo",".cache",".DS_Store"]);
const SECRET_FILE=/^\.env(\..*)?$|\.(pem|key|p12|pfx|crt|cer|keystore|jks)$|^id_(rsa|ed25519|ecdsa)(\.pub)?$|^\.npmrc$|^\.netrc$/i;

export interface VercelOptions{fetcher?:typeof fetch;env?:NodeJS.ProcessEnv}
type Json=Record<string,any>;

function token(env:NodeJS.ProcessEnv):string{
  const t=env.VERCEL_TOKEN?.trim();
  if(!t)throw new Error("vercel_not_connected: connect Vercel in Control Center -> Integrations -> Platforms (VERCEL_TOKEN).");
  return t;
}
function teamQuery(env:NodeJS.ProcessEnv,payload:Json):string{
  const team=typeof payload.teamId==="string"&&/^[\w-]{3,80}$/.test(payload.teamId)?payload.teamId:env.VERCEL_TEAM_ID?.trim();
  return team?`teamId=${encodeURIComponent(team)}`:"";
}
const withQuery=(p:string,...parts:string[])=>{const q=parts.filter(Boolean).join("&");return q?p+(p.includes("?")?"&":"?")+q:p;};
const idPart=(v:unknown,what:string)=>{const s=String(v??"").trim();if(!/^[\w.-]{1,120}$/.test(s))throw new Error(what+" is required.");return encodeURIComponent(s);};

async function call(o:Required<VercelOptions>,method:string,p:string,body?:unknown,extra:Record<string,string>={}):Promise<any>{
  const response=await o.fetcher(API+p,{method,redirect:"error",signal:AbortSignal.timeout(60_000),
    headers:{authorization:"Bearer "+token(o.env),...(body!==undefined&&!(body instanceof Uint8Array)?{"content-type":"application/json"}:{}),...extra},
    ...(body!==undefined?{body:body instanceof Uint8Array?new Blob([body as Uint8Array<ArrayBuffer>]):JSON.stringify(body)}:{})});
  const text=await response.text();
  let data:any=null;try{data=text?JSON.parse(text):null;}catch{data={raw:text.slice(0,300)};}
  if(!response.ok){
    const err=data?.error;
    const e=new Error(`Vercel ${response.status}: ${err?.message??err?.code??text.slice(0,200)}`) as Error&{code?:string;missing?:string[]};
    e.code=err?.code;if(Array.isArray(err?.missing))e.missing=err.missing;
    throw e;
  }
  return data;
}

const deploymentView=(d:Json)=>({id:d.uid??d.id,url:d.url?`https://${d.url}`:undefined,state:d.readyState??d.state,target:d.target??"preview",createdAt:d.createdAt??d.created,
  ...(d.meta?.githubCommitMessage?{commit:String(d.meta.githubCommitMessage).slice(0,120)}:{}),...(d.inspectorUrl?{inspect:d.inspectorUrl}:{}),...(d.errorMessage?{error:String(d.errorMessage).slice(0,500)}:{})});

/** Files to upload, relative POSIX paths, skipping secrets and build caches. Exported for tests. */
export function collectFiles(root:string):Array<{file:string;abs:string;size:number}>{
  const ignore=new Set<string>();const ignorePrefixes:string[]=[];const ignoreSuffixes:string[]=[];
  try{
    for(const raw of fs.readFileSync(path.join(root,".vercelignore"),"utf8").split(/\r?\n/)){
      const line=raw.trim().replace(/^\/+/,"").replace(/\/+$/,"");
      if(!line||line.startsWith("#")||line.startsWith("!"))continue;
      if(line.startsWith("*."))ignoreSuffixes.push(line.slice(1));else if(line.endsWith("/*"))ignorePrefixes.push(line.slice(0,-2)+"/");else ignore.add(line);
    }
  }catch{}
  const out:Array<{file:string;abs:string;size:number}>=[];let bytes=0;
  const walk=(dir:string,rel:string)=>{
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const relPath=rel?rel+"/"+entry.name:entry.name;
      if(entry.isSymbolicLink())continue;
      if(ignore.has(relPath)||ignore.has(entry.name)||ignorePrefixes.some(p=>relPath.startsWith(p))||ignoreSuffixes.some(s=>entry.name.endsWith(s)))continue;
      if(entry.isDirectory()){if(!ALWAYS_SKIP_DIRS.has(entry.name))walk(path.join(dir,entry.name),relPath);continue;}
      if(!entry.isFile()||SECRET_FILE.test(entry.name)||ALWAYS_SKIP_DIRS.has(entry.name))continue;
      const abs=path.join(dir,entry.name);const size=fs.statSync(abs).size;
      out.push({file:relPath,abs,size});bytes+=size;
      if(out.length>MAX_FILES)throw new Error(`Too many files to deploy (over ${MAX_FILES}); add a .vercelignore.`);
      if(bytes>MAX_BYTES)throw new Error("The project is over 200 MB; add a .vercelignore (build output and media do not belong in the upload).");
    }
  };
  walk(root,"");
  return out;
}

async function deploy(o:Required<VercelOptions>,request:{projectId?:string;payload:unknown}){
  const p=(request.payload??{}) as Json;
  const base=projectDir(request.projectId??"default",o.env);
  const sub=typeof p.dir==="string"&&p.dir.trim()?p.dir.trim():".";
  const root=path.resolve(base,sub);
  if(!fs.existsSync(root)||!fs.statSync(root).isDirectory())throw new Error("Nothing to deploy: "+root+" is not a folder.");
  if(!isPathInside(fs.realpathSync(base),fs.realpathSync(root)))throw new Error("dir must stay inside the project folder.");
  const files=collectFiles(root);
  if(!files.length)throw new Error("Nothing to deploy: the folder is empty after skipping secrets and caches.");
  const shas=files.map(f=>({...f,sha:crypto.createHash("sha1").update(fs.readFileSync(f.abs)).digest("hex")}));
  let name=typeof p.name==="string"&&p.name.trim()?p.name.trim():"";
  if(!name){try{name=String(JSON.parse(fs.readFileSync(path.join(base,"package.json"),"utf8")).name??"");}catch{}}
  name=(name||path.basename(base)).toLowerCase().replace(/^@[^/]+\//,"").replace(/[^a-z0-9._-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,100)||"site";
  const team=teamQuery(o.env,p);
  const body={name,project:name,files:shas.map(f=>({file:f.file,sha:f.sha,size:f.size}))};
  const create=()=>call(o,"POST",withQuery("/v13/deployments","skipAutoDetectionConfirmation=1",team),body);
  const upload=async(list:typeof shas)=>{
    let i=0;
    const worker=async()=>{while(i<list.length){const f=list[i++]!;const data=fs.readFileSync(f.abs);
      await call(o,"POST",withQuery("/v2/files",team),new Uint8Array(data.buffer,data.byteOffset,data.byteLength),{"content-type":"application/octet-stream","x-vercel-digest":f.sha,"x-now-size":String(data.length)});}};
    await Promise.all(Array.from({length:Math.min(8,list.length)},worker));
  };
  let created:any;
  try{created=await create();}
  catch(error){
    const missing=(error as {missing?:string[]}).missing;
    if((error as {code?:string}).code!=="missing_files"||!missing)throw error;
    const need=new Set(missing);
    await upload(shas.filter(f=>need.has(f.sha)));
    created=await create();
  }
  return{...deploymentView(created),project:name,files:files.length,note:"Preview deployment: Vercel is building it. Check it with vercel.deployments.list {deploymentId}; production only through vercel.promote (owner approval)."};
}

export function registerVercelTools(core:LayanXCore,options:VercelOptions={}){
  const o={fetcher:options.fetcher??fetch,get env(){return options.env??process.env;}} as Required<VercelOptions>;
  const defs:Array<[string,string,"L1_READ"|"L3_MODIFY"|"L4_EXECUTE",boolean,(r:{projectId?:string;payload:unknown})=>Promise<unknown>]>=[
    ["vercel.projects.list","list Vercel projects with framework, domains and latest production URL; payload {search?, teamId?}","L1_READ",false,async r=>{
      const p=(r.payload??{}) as Json;
      const q=typeof p.search==="string"&&p.search.trim()?`search=${encodeURIComponent(p.search.trim().slice(0,80))}`:"";
      const data=await call(o,"GET",withQuery("/v10/projects","limit=50",q,teamQuery(o.env,p)));
      return{projects:(data?.projects??[]).map((x:Json)=>({id:x.id,name:x.name,framework:x.framework??null,
        domains:(x.alias??x.targets?.production?.alias??[]).map((a:any)=>typeof a==="string"?a:a?.domain).filter(Boolean).slice(0,10),
        production:x.targets?.production?.url?`https://${x.targets.production.url}`:null,updatedAt:x.updatedAt}))};
    }],
    ["vercel.deployments.list","recent Vercel deployments of a project (payload {project}); with {deploymentId}: its state, URL and the last build log lines to diagnose a failed build","L1_READ",false,async r=>{
      const p=(r.payload??{}) as Json;const team=teamQuery(o.env,p);
      if(p.deploymentId){
        const id=idPart(p.deploymentId,"deploymentId");
        const d=await call(o,"GET",withQuery(`/v13/deployments/${id}`,team));
        const events=await call(o,"GET",withQuery(`/v3/deployments/${id}/events`,"builds=1","direction=backward","limit=80",team)).catch(()=>[]);
        const lines=(Array.isArray(events)?events:[]).map((e:Json)=>({type:e.type,level:e.level,text:String(e.text??e.payload?.text??"").slice(0,400)})).filter((e:Json)=>e.text).reverse();
        return{deployment:deploymentView(d),errors:lines.filter((l:Json)=>l.level==="error"||l.type==="stderr"||l.type==="fatal").slice(-20),log:lines.slice(-40)};
      }
      const projectQ=p.project?`projectId=${idPart(p.project,"project")}`:"";
      const data=await call(o,"GET",withQuery("/v6/deployments","limit=15",projectQ,team));
      return{deployments:(data?.deployments??[]).map(deploymentView)};
    }],
    ["vercel.deploy","deploy the current project folder to Vercel as a PREVIEW (never production); payload {dir? (e.g. \"dist\" for a static build), name? (Vercel project), teamId?}. Secrets (.env, keys) are never uploaded.","L3_MODIFY",true,r=>deploy(o,r)],
    ["vercel.promote","make a READY Vercel deployment the production version of its project (owner approval); payload {project, deploymentId}","L4_EXECUTE",true,async r=>{
      const p=(r.payload??{}) as Json;const team=teamQuery(o.env,p);
      const deploymentId=idPart(p.deploymentId,"deploymentId");
      const d=await call(o,"GET",withQuery(`/v13/deployments/${deploymentId}`,team));
      if((d.readyState??d.state)!=="READY")throw new Error(`Deployment ${deploymentId} is ${d.readyState??d.state}; only a READY deployment can go to production.`);
      const project=idPart(p.project??d.projectId,"project");
      await call(o,"POST",withQuery(`/v10/projects/${project}/promote/${deploymentId}`,team),{});
      return{promoted:deploymentId,project:decodeURIComponent(project),url:d.url?`https://${d.url}`:undefined};
    }]
  ];
  for(const [name,description,permission,dangerous,run] of defs){
    core.tools.register({name,description,permission,dangerous,actions:[name],tags:["vercel","deploy","hosting","website","web","نشر","موقع"]});
    const adapter:ToolAdapter={execute:request=>run({...(request.projectId?{projectId:request.projectId}:{}),payload:request.payload})};
    core.toolAdapters.register(name,adapter);
  }
}
