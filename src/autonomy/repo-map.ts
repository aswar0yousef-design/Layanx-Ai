import fs from "node:fs";
import path from "node:path";

/**
 * Repo map (the idea behind Aider's repo map): the project's important definitions with their
 * signatures, ranked by how much the rest of the code uses them (PageRank over "file A uses a
 * name defined in file B"), cut to a token budget. A coding model sees the shape of the whole
 * project in ~1-2k tokens and reuses what exists instead of writing a second copy.
 *
 * findReferences() answers "who uses this?" before a change, so fixing one thing does not
 * silently break another. Regex-based: no native parser to install on Windows.
 */
const IGNORE=new Set(["node_modules",".git","dist","build",".next",".nuxt","out","coverage",".layanx","vendor","__pycache__",".venv","venv","env","target","bin","obj",".dart_tool",".idea",".vscode",".turbo",".cache","android","ios","Pods"]);
const EXT=new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".vue",".svelte",".py",".dart",".cs",".go",".java",".kt",".php",".rb",".rs"]);
const MAX_FILE_BYTES=400_000;

export interface Definition{file:string;name:string;kind:string;line:number;signature:string}
export interface RepoMap{text:string;files:number;definitions:number;ranked:Array<{file:string;rank:number}>;truncated:boolean}
export interface Reference{file:string;line:number;text:string}

type Rule={re:RegExp;kind:string};
const JS:Rule[]=[
  {re:/^\s*export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,kind:"function"},
  {re:/^\s*export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,kind:"class"},
  {re:/^\s*export\s+(?:declare\s+)?interface\s+([A-Za-z_$][\w$]*)/,kind:"interface"},
  {re:/^\s*export\s+(?:declare\s+)?type\s+([A-Za-z_$][\w$]*)\s*[=<]/,kind:"type"},
  {re:/^\s*export\s+(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/,kind:"enum"},
  {re:/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,kind:"const"},
  {re:/^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,kind:"function"},
  {re:/^(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,kind:"class"},
  {re:/^\s{1,4}(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|async\s+|override\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?::[^{=]+)?\{\s*$/,kind:"method"}
];
const RULES:Record<string,Rule[]>={
  ".ts":JS,".tsx":JS,".js":JS,".jsx":JS,".mjs":JS,".cjs":JS,".vue":JS,".svelte":JS,
  ".py":[{re:/^class\s+([A-Za-z_]\w*)/,kind:"class"},{re:/^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,kind:"function"},{re:/^\s{4}(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,kind:"method"}],
  ".dart":[{re:/^(?:abstract\s+)?(?:class|mixin|enum|extension)\s+([A-Za-z_]\w*)/,kind:"class"},{re:/^\s{0,2}(?:Future<[^>]*>|Stream<[^>]*>|void|Widget|bool|int|double|String|[A-Z]\w*(?:<[^>]*>)?)\??\s+([a-zA-Z_]\w*)\s*\(/,kind:"function"}],
  ".cs":[{re:/\b(?:class|interface|record|struct|enum)\s+([A-Za-z_]\w*)/,kind:"class"},{re:/^\s*(?:public|internal|protected)\s+(?:static\s+|async\s+|virtual\s+|override\s+)*[\w<>\[\],?]+\s+([A-Za-z_]\w*)\s*\(/,kind:"method"}],
  ".go":[{re:/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,kind:"function"},{re:/^type\s+([A-Za-z_]\w*)\s+/,kind:"type"}],
  ".java":[{re:/\b(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/,kind:"class"},{re:/^\s*(?:public|protected)\s+(?:static\s+)?[\w<>\[\],]+\s+([a-zA-Z_]\w*)\s*\(/,kind:"method"}],
  ".kt":[{re:/\b(?:class|interface|object)\s+([A-Za-z_]\w*)/,kind:"class"},{re:/^\s*(?:suspend\s+)?fun\s+(?:<[^>]*>\s*)?([a-zA-Z_]\w*)\s*\(/,kind:"function"}],
  ".php":[{re:/\b(?:class|interface|trait)\s+([A-Za-z_]\w*)/,kind:"class"},{re:/\bfunction\s+([A-Za-z_]\w*)\s*\(/,kind:"function"}],
  ".rb":[{re:/^\s*(?:class|module)\s+([A-Z]\w*)/,kind:"class"},{re:/^\s*def\s+(?:self\.)?([a-z_]\w*[?!]?)/,kind:"function"}],
  ".rs":[{re:/^\s*pub\s+(?:async\s+)?fn\s+([a-z_]\w*)/,kind:"function"},{re:/^\s*pub\s+(?:struct|enum|trait)\s+([A-Z]\w*)/,kind:"type"}]
};
const KEYWORDS=new Set(["if","for","while","switch","catch","return","function","constructor","get","set","new","else","try","do","with","await","async","super","this","main","init","build","render","test","toString","dispose","setState"]);

export function listCodeFiles(dir:string,maxFiles=1500):{files:string[];truncated:boolean}{
  const out:string[]=[];let truncated=false;
  const walk=(abs:string,rel:string,depth:number)=>{
    if(out.length>=maxFiles){truncated=true;return;}
    let entries:fs.Dirent[]=[];try{entries=fs.readdirSync(abs,{withFileTypes:true});}catch{return;}
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    for(const e of entries){
      if(e.name.startsWith(".")&&e.name!==".github")continue;
      const r=rel?rel+"/"+e.name:e.name;
      if(e.isDirectory()){if(!IGNORE.has(e.name)&&depth<14)walk(path.join(abs,e.name),r,depth+1);continue;}
      if(e.isFile()&&EXT.has(path.extname(e.name).toLowerCase())&&!/\.min\.js$|\.d\.ts$|\.g\.dart$|\.freezed\.dart$/.test(e.name)){out.push(r);if(out.length>=maxFiles){truncated=true;return;}}
    }
  };
  walk(dir,"",0);
  return{files:out,truncated};
}

function readText(dir:string,rel:string):string{
  try{const abs=path.join(dir,rel);if(fs.statSync(abs).size>MAX_FILE_BYTES)return"";return fs.readFileSync(abs,"utf8");}catch{return"";}
}

/** The declaration part of a line: stops at the body's "{" (outside parentheses), so one-line functions do not leak their body. */
function signatureOf(line:string):string{
  let depth=0;const t=line.trim();
  for(let i=0;i<t.length;i++){
    const c=t[i];
    if(c==="(")depth++;else if(c===")")depth=Math.max(0,depth-1);
    else if(c==="{"&&depth===0&&i>0)return t.slice(0,i).trim().slice(0,160);
  }
  return t.slice(0,160);
}

export function extractDefinitions(rel:string,text:string):Definition[]{
  const rules=RULES[path.extname(rel).toLowerCase()];if(!rules)return[];
  const defs:Definition[]=[];const seen=new Set<string>();
  const lines=text.split("\n");
  for(let i=0;i<lines.length&&defs.length<400;i++){
    const line=lines[i]!;if(line.length>400)continue;
    for(const rule of rules){
      const m=rule.re.exec(line);
      if(m&&m[1]&&!KEYWORDS.has(m[1])&&!seen.has(m[1])){seen.add(m[1]);defs.push({file:rel,name:m[1],kind:rule.kind,line:i+1,signature:signatureOf(line)});break;}
    }
  }
  return defs;
}

/** PageRank over the file graph; personalised toward files that match the focus terms. */
function pageRank(nodes:string[],edges:Map<string,Map<string,number>>,personal:Map<string,number>,iterations=25,damping=0.85):Map<string,number>{
  const n=nodes.length;if(!n)return new Map();
  const totalPersonal=[...personal.values()].reduce((a,b)=>a+b,0);
  const base=(file:string)=>totalPersonal>0?(personal.get(file)??0)/totalPersonal:1/n;
  let rank=new Map(nodes.map(f=>[f,1/n]));
  const outWeight=new Map(nodes.map(f=>[f,[...(edges.get(f)?.values()??[])].reduce((a,b)=>a+b,0)]));
  for(let it=0;it<iterations;it++){
    const next=new Map(nodes.map(f=>[f,(1-damping)*base(f)]));
    let dangling=0;
    for(const f of nodes){
      const r=rank.get(f)!;const w=outWeight.get(f)!;
      if(!w){dangling+=r;continue;}
      for(const [to,weight] of edges.get(f)!)next.set(to,next.get(to)!+damping*r*weight/w);
    }
    for(const f of nodes)next.set(f,next.get(f)!+damping*dangling*base(f));
    rank=next;
  }
  return rank;
}

export function buildRepoMap(dir:string,options:{focus?:string;tokenBudget?:number;maxFiles?:number}={}):RepoMap{
  const {files,truncated}=listCodeFiles(dir,options.maxFiles??1500);
  const texts=new Map(files.map(f=>[f,readText(dir,f)]));
  const defs=files.flatMap(f=>extractDefinitions(f,texts.get(f)!));
  const definedIn=new Map<string,Set<string>>();
  for(const d of defs)if(d.name.length>=3){const s=definedIn.get(d.name)??new Set();s.add(d.file);definedIn.set(d.name,s);}
  // Names defined in very many files (render, handler...) say nothing about structure.
  for(const [name,where] of definedIn)if(where.size>5)definedIn.delete(name);
  const usage=new Map<string,Map<string,number>>();
  const filesUsing=new Map<string,number>();
  for(const f of files){
    const counts=new Map<string,number>();
    for(const m of texts.get(f)!.matchAll(/[A-Za-z_$][\w$]{2,}/g)){const id=m[0];if(definedIn.has(id))counts.set(id,(counts.get(id)??0)+1);}
    usage.set(f,counts);
    for(const id of counts.keys())filesUsing.set(id,(filesUsing.get(id)??0)+1);
  }
  // Plain words ("project", "api", "settings") show up everywhere without being references:
  // drop names used by more than a fifth of the files and down-weight short lower-case names.
  const common=Math.max(10,files.length*0.2);
  const weightOf=(id:string)=>(filesUsing.get(id)??0)>common?0:/[A-Z_]/.test(id.slice(1))||/^[A-Z]/.test(id)||id.length>=8?1:0.25;
  const edges=new Map<string,Map<string,number>>();
  const refCount=new Map<string,number>();
  for(const f of files){
    for(const [id,count] of usage.get(f)!){
      const weight=weightOf(id);if(!weight)continue;
      for(const target of definedIn.get(id)!){
        if(target===f)continue;
        refCount.set(id,(refCount.get(id)??0)+count*weight);
        const row=edges.get(f)??new Map<string,number>();row.set(target,(row.get(target)??0)+weight*Math.sqrt(count));edges.set(f,row);
      }
    }
  }
  const focusTerms=(options.focus??"").toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(t=>t.length>=3);
  const personal=new Map<string,number>();
  if(focusTerms.length)for(const f of files){
    const lower=f.toLowerCase();const names=defs.filter(d=>d.file===f).map(d=>d.name.toLowerCase());
    const hits=focusTerms.filter(t=>lower.includes(t)||names.some(n=>n.includes(t))).length;
    if(hits)personal.set(f,hits);
  }
  const rank=pageRank(files,edges,personal);
  // Files that match the task itself come first; their neighbours follow through the personalised rank.
  const ranked=[...rank].map(([file,r])=>({file,rank:r*(1+4*(personal.get(file)??0))})).sort((a,b)=>b.rank-a.rank);
  const budgetChars=Math.max(400,Math.min(options.tokenBudget??1500,8000))*4;
  const byFile=new Map<string,Definition[]>();for(const d of defs){const l=byFile.get(d.file)??[];l.push(d);byFile.set(d.file,l);}
  const lines:string[]=[];let used=0;let cut=false;
  for(const {file} of ranked){
    const list=(byFile.get(file)??[]).sort((a,b)=>(refCount.get(b.name)??0)-(refCount.get(a.name)??0)||a.line-b.line).slice(0,12).sort((a,b)=>a.line-b.line);
    if(!list.length)continue;
    const block=[file+":",...list.map(d=>`  ${d.line}: ${d.signature}`)].join("\n");
    if(used+block.length+1>budgetChars){cut=true;break;}
    lines.push(block);used+=block.length+1;
  }
  return{text:lines.join("\n"),files:files.length,definitions:defs.length,ranked:ranked.slice(0,20),truncated:truncated||cut};
}

/** Every definition of `symbol` and every line that uses it (whole-word match). */
export function findReferences(dir:string,symbol:string,options:{maxResults?:number;maxFiles?:number}={}):{definitions:Definition[];references:Reference[];files:string[];truncated:boolean}{
  if(!/^[A-Za-z_$][\w$]{1,80}$/.test(symbol))throw new Error("symbol must be a single identifier (letters, digits, _ or $).");
  const max=Math.min(Math.max(options.maxResults??200,1),1000);
  const {files,truncated}=listCodeFiles(dir,options.maxFiles??3000);
  const word=new RegExp(`(^|[^\\w$])${symbol.replace(/\$/g,"\\$")}(?![\\w$])`);
  const definitions:Definition[]=[];const references:Reference[]=[];const touched=new Set<string>();
  let capped=false;
  for(const f of files){
    const text=readText(dir,f);if(!text.includes(symbol))continue;
    definitions.push(...extractDefinitions(f,text).filter(d=>d.name===symbol));
    const lines=text.split("\n");
    for(let i=0;i<lines.length;i++){
      if(!word.test(lines[i]!))continue;
      touched.add(f);
      if(references.length>=max){capped=true;break;}
      references.push({file:f,line:i+1,text:lines[i]!.trim().slice(0,200)});
    }
  }
  return{definitions,references,files:[...touched],truncated:truncated||capped};
}
