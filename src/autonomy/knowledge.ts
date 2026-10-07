import fs from "node:fs";
import path from "node:path";
import {detectProject} from "./project-runner.js";
import {projectDir} from "./project-dir.js";

/**
 * Project memory lives INSIDE each project, in .layanx/, so it travels with the code and any
 * agent (LayanX, VS Code, a person) can read it:
 *
 *   PROJECT.md       purpose and rules (written by the owner, seeded by LayanX)
 *   ARCHITECTURE.md  auto-generated map: folders, entry points, scripts, largest files, duplicates
 *   DECISIONS.md     why things are the way they are (agents append, never rewrite)
 *   KNOWN_ISSUES.md  open problems ("- [ ] ...") and resolved ones ("- [x] ...")
 *   CHANGELOG.md     every autonomous job and what it changed
 *   health.json      last result of tests / build / typecheck / lint / security / visual
 *   index.json       machine-readable index used for the map
 *
 * Before planning, the supervisor reads a compact summary of all of this, so new work builds on
 * the existing structure instead of rebuilding it.
 */
const IGNORE=new Set(["node_modules",".git","dist","build",".next",".nuxt","out","coverage",".layanx","vendor","__pycache__",".venv","venv","env","target","bin","obj",".dart_tool",".idea",".vscode",".turbo",".cache",".parcel-cache","android","ios"]);
const CODE_EXT=new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".vue",".svelte",".py",".dart",".cs",".go",".rs",".java",".kt",".php",".rb",".html",".css",".scss",".sql"]);
const AUTO_START="<!-- layanx:auto:start -->",AUTO_END="<!-- layanx:auto:end -->";

export interface ProjectIndex{
  generatedAt:string;stack:string;scripts:string[];dependencies:string[];
  files:{count:number;lines:number;byExt:Record<string,number>};
  dirs:Array<{path:string;files:number;lines:number}>;
  entryPoints:string[];tests:{files:number;dirs:string[]};
  largest:Array<{path:string;lines:number}>;duplicates:Array<{name:string;paths:string[]}>;truncated:boolean;
}
export interface Health{[check:string]:{ok:boolean;at:string;summary?:string;score?:number}}

const dotDir=(dir:string)=>path.join(dir,".layanx");
/** Volatile files (rewritten on every check) stay out of Git so they never block merges or clutter history. */
export function ensureLayanxIgnore(dir:string){
  try{const d=dotDir(dir);fs.mkdirSync(d,{recursive:true});const f=path.join(d,".gitignore");
    if(!fs.existsSync(f))fs.writeFileSync(f,"# Rewritten on every check; the rest of .layanx/ is project memory worth keeping in Git.\nscreens/\nhealth.json\nsecurity.json\nindex.json\n");}catch{}
}
const read=(file:string)=>{try{return fs.readFileSync(file,"utf8");}catch{return"";}};

export function indexProject(dir:string,maxFiles=6000):ProjectIndex{
  const info=detectProject(dir);
  const files:Array<{rel:string;lines:number}>=[];
  let truncated=false;
  const walk=(abs:string,rel:string,depth:number)=>{
    if(files.length>=maxFiles){truncated=true;return;}
    let entries:fs.Dirent[]=[];try{entries=fs.readdirSync(abs,{withFileTypes:true});}catch{return;}
    for(const e of entries){
      if(e.name.startsWith(".")&&e.name!==".github")continue;
      const r=rel?rel+"/"+e.name:e.name;
      if(e.isDirectory()){if(!IGNORE.has(e.name)&&depth<12)walk(path.join(abs,e.name),r,depth+1);continue;}
      if(!e.isFile())continue;
      const ext=path.extname(e.name).toLowerCase();
      let lines=0;
      if(CODE_EXT.has(ext)&&!e.name.endsWith(".min.js")){try{const st=fs.statSync(path.join(abs,e.name));if(st.size<1_000_000)lines=fs.readFileSync(path.join(abs,e.name),"utf8").split("\n").length;}catch{}}
      files.push({rel:r,lines});
      if(files.length>=maxFiles){truncated=true;return;}
    }
  };
  walk(dir,"",0);
  const byExt:Record<string,number>={};for(const f of files){const x=path.extname(f.rel).toLowerCase()||"(none)";byExt[x]=(byExt[x]??0)+1;}
  const dirMap=new Map<string,{files:number;lines:number}>();
  for(const f of files){const parts=f.rel.split("/");const key=parts.length>2?parts.slice(0,2).join("/"):parts.length===2?parts[0]!:".";const d=dirMap.get(key)??{files:0,lines:0};d.files++;d.lines+=f.lines;dirMap.set(key,d);}
  const ENTRY=/^(src\/)?(index|main|app|server|cli)\.(ts|tsx|js|jsx|mjs|py|dart)$|^(lib\/main\.dart|manage\.py|app\.py|Program\.cs|pages\/index\.\w+|app\/page\.\w+|src\/App\.\w+)$/i;
  const tests=files.filter(f=>/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.\w+$|_test\.(py|dart|go)$/.test(f.rel));
  const names=new Map<string,string[]>();
  for(const f of files){const b=path.basename(f.rel).toLowerCase();if(!CODE_EXT.has(path.extname(b))||/^(index|main|page|layout|route|__init__|mod|types?)\./.test(b)||tests.includes(f))continue;names.set(b,[...(names.get(b)??[]),f.rel]);}
  let deps:string[]=[];
  try{const pkg=JSON.parse(read(path.join(dir,"package.json"))) as {dependencies?:Record<string,string>;devDependencies?:Record<string,string>};deps=[...Object.keys(pkg.dependencies??{}),...Object.keys(pkg.devDependencies??{}).map(d=>d+" (dev)")];}catch{}
  if(!deps.length){const req=read(path.join(dir,"requirements.txt"));if(req)deps=req.split("\n").map(l=>l.trim().split(/[=<>~ ]/)[0]!).filter(Boolean);}
  return{generatedAt:new Date().toISOString(),stack:info.stack,scripts:info.scripts,dependencies:deps.slice(0,60),
    files:{count:files.length,lines:files.reduce((n,f)=>n+f.lines,0),byExt},
    dirs:[...dirMap].map(([p,v])=>({path:p,...v})).sort((a,b)=>b.lines-a.lines).slice(0,30),
    entryPoints:files.map(f=>f.rel).filter(r=>ENTRY.test(r)).slice(0,12),
    tests:{files:tests.length,dirs:[...new Set(tests.map(t=>path.dirname(t.rel)))].slice(0,10)},
    largest:files.filter(f=>f.lines>0).sort((a,b)=>b.lines-a.lines).slice(0,10).map(f=>({path:f.rel,lines:f.lines})),
    duplicates:[...names].filter(([,p])=>p.length>1).slice(0,15).map(([name,paths])=>({name,paths:paths.slice(0,5)})),truncated};
}

export function architectureMarkdown(ix:ProjectIndex):string{
  return[`## Map (generated ${ix.generatedAt.slice(0,16).replace("T"," ")})`,"",
    `Stack: **${ix.stack}** · ${ix.files.count} files · ${ix.files.lines} lines of code${ix.truncated?" (partial: large project)":""}`,
    ix.scripts.length?`Scripts: ${ix.scripts.map(s=>"`"+s+"`").join(", ")}`:"",
    ix.entryPoints.length?`Entry points: ${ix.entryPoints.map(s=>"`"+s+"`").join(", ")}`:"",
    `Tests: ${ix.tests.files} file(s)${ix.tests.dirs.length?" in "+ix.tests.dirs.map(d=>"`"+d+"`").join(", "):""}`,"",
    "| Folder | Files | Lines |","|---|---:|---:|",...ix.dirs.slice(0,20).map(d=>`| \`${d.path}\` | ${d.files} | ${d.lines} |`),"",
    ix.largest.length?"Largest files: "+ix.largest.slice(0,6).map(f=>`\`${f.path}\` (${f.lines})`).join(", "):"",
    ix.duplicates.length?"\n**Same file name in several places (check before adding another):** "+ix.duplicates.map(d=>`\`${d.name}\`: ${d.paths.map(p=>"`"+p+"`").join(", ")}`).join("; "):"",
    ix.dependencies.length?`\nDependencies: ${ix.dependencies.slice(0,30).join(", ")}`:""].filter(s=>s!=="").join("\n");
}

/** Re-index and rewrite only the generated part of ARCHITECTURE.md; anything the owner wrote stays. */
export function refreshKnowledge(dir:string):ProjectIndex{
  const ix=indexProject(dir);
  const d=dotDir(dir);fs.mkdirSync(d,{recursive:true});ensureLayanxIgnore(dir);
  fs.writeFileSync(path.join(d,"index.json"),JSON.stringify(ix,null,1));
  const file=path.join(d,"ARCHITECTURE.md");const old=read(file);
  const block=`${AUTO_START}\n${architectureMarkdown(ix)}\n${AUTO_END}`;
  const next=old.includes(AUTO_START)&&old.includes(AUTO_END)?old.replace(new RegExp(`${AUTO_START}[\\s\\S]*?${AUTO_END}`),block):`# Architecture\n\nNotes you add above or below the generated block are kept.\n\n${block}\n${old?"\n"+old:""}`;
  fs.writeFileSync(file,next);
  if(!fs.existsSync(path.join(d,"PROJECT.md")))fs.writeFileSync(path.join(d,"PROJECT.md"),`# ${path.basename(dir)}\n\n## Purpose\n(What this project is for. LayanX reads this before every task.)\n\n## Rules the agent must respect\n- Keep existing features working.\n- Edit existing files instead of rewriting them.\n`);
  return ix;
}

export function recordDecision(dir:string,title:string,why:string,by="LayanX"):void{
  const d=dotDir(dir);fs.mkdirSync(d,{recursive:true});const f=path.join(d,"DECISIONS.md");
  if(!fs.existsSync(f))fs.writeFileSync(f,"# Decisions\n\nWhy things are the way they are. Append only.\n");
  fs.appendFileSync(f,`\n## ${new Date().toISOString().slice(0,10)} — ${title.slice(0,140)}\n- ${why.slice(0,1500).replace(/\n/g,"\n  ")}\n- By: ${by}\n`);
}
export function recordIssue(dir:string,title:string,detail=""):void{
  const d=dotDir(dir);fs.mkdirSync(d,{recursive:true});const f=path.join(d,"KNOWN_ISSUES.md");
  if(!fs.existsSync(f))fs.writeFileSync(f,"# Known issues\n\n");
  const clean=title.replace(/\n/g," ").slice(0,160);
  if(read(f).includes(`- [ ] ${clean}`))return;
  fs.appendFileSync(f,`- [ ] ${clean}${detail?" — "+detail.replace(/\n/g," ").slice(0,400):""} (${new Date().toISOString().slice(0,10)})\n`);
}
export function resolveIssue(dir:string,title:string):boolean{
  const f=path.join(dotDir(dir),"KNOWN_ISSUES.md");const t=read(f);const clean=title.replace(/\n/g," ").slice(0,160);
  if(!t.includes(`- [ ] ${clean}`))return false;
  fs.writeFileSync(f,t.replace(`- [ ] ${clean}`,`- [x] ${clean}`));return true;
}
export function openIssues(dir:string):string[]{return read(path.join(dotDir(dir),"KNOWN_ISSUES.md")).split("\n").filter(l=>l.startsWith("- [ ] ")).map(l=>l.slice(6));}

export function readHealth(dir:string):Health{try{return JSON.parse(read(path.join(dotDir(dir),"health.json"))) as Health;}catch{return{};}}
export function updateHealth(dir:string,check:string,value:{ok:boolean;summary?:string;score?:number}):void{
  try{const d=dotDir(dir);fs.mkdirSync(d,{recursive:true});ensureLayanxIgnore(dir);const h=readHealth(dir);h[check]={...value,at:new Date().toISOString(),...(value.summary?{summary:value.summary.slice(0,600)}:{})};fs.writeFileSync(path.join(d,"health.json"),JSON.stringify(h,null,1));}catch{}
}

/** Compact text the planner reads before every task (keeps prompts small for local models). */
export function knowledgeSummary(projectId:string,maxChars=3500):string{
  let dir:string;try{dir=projectDir(projectId);}catch{return"";}
  const d=dotDir(dir);if(!fs.existsSync(d))return"";
  const purpose=read(path.join(d,"PROJECT.md")).slice(0,1200);
  let ix:ProjectIndex|null=null;try{ix=JSON.parse(read(path.join(d,"index.json"))) as ProjectIndex;}catch{}
  const decisions=("\n"+read(path.join(d,"DECISIONS.md"))).split("\n## ").slice(1).slice(-6).map(s=>"- "+s.split("\n")[0]).join("\n");
  const issues=openIssues(dir).slice(0,8).map(i=>"- "+i).join("\n");
  const changes=("\n"+read(path.join(d,"CHANGELOG.md"))).split("\n## ").slice(1).slice(-3).map(s=>"- "+s.split("\n")[0]).join("\n");
  const health=Object.entries(readHealth(dir)).map(([k,v])=>`${k}:${v.ok?"ok":"FAIL"}`).join(", ");
  const parts=[purpose&&`PROJECT:\n${purpose}`,
    ix&&`MAP: ${ix.stack}, ${ix.files.count} files; folders ${ix.dirs.slice(0,8).map(x=>x.path).join(", ")}; entry ${ix.entryPoints.slice(0,4).join(", ")||"?"}; tests ${ix.tests.files}`+(ix.duplicates.length?`; duplicate names: ${ix.duplicates.slice(0,4).map(x=>x.name).join(", ")}`:""),
    decisions&&`DECISIONS (respect them):\n${decisions}`,issues&&`OPEN ISSUES:\n${issues}`,changes&&`RECENT CHANGES:\n${changes}`,health&&`HEALTH: ${health}`].filter(Boolean) as string[];
  const text=parts.join("\n\n");
  return text.length>maxChars?text.slice(0,maxChars)+"…":text;
}
