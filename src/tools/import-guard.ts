import fs from "node:fs";
import path from "node:path";
import {builtinModules} from "node:module";

/**
 * Packages a source file imports that the project does not have. Models kept writing pages that import
 * libraries nobody installed (react-router-dom, react-i18next, a made-up "../hooks/useTranslation" is a path and
 * stays the build's business): the build then failed attempt after attempt. Checked only when the project has
 * installed its packages (package.json and node_modules), so a project being set up is never blocked.
 */
const BUILTIN=new Set([...builtinModules,...builtinModules.map(m=>"node:"+m)]);
const SPECIFIER=/(?:^|[^\w$.])(?:import\s+(?:[\w$*{}\s,]+\s+from\s+)?|export\s+[\w$*{}\s,]+\s+from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

export function packageName(specifier:string):string|undefined{
  if(/^(?:\.|\/|[a-z]+:|#|~|@\/|virtual:)/i.test(specifier))return undefined; // relative, absolute, URL, alias, virtual
  if(BUILTIN.has(specifier)||BUILTIN.has(specifier.split("/")[0]!))return undefined;
  const parts=specifier.split("/");
  return specifier.startsWith("@")?(parts.length>1?parts[0]+"/"+parts[1]:undefined):parts[0];
}

export function missingPackages(projectDir:string,content:string):string[]{
  let manifest:Record<string,unknown>;
  try{manifest=JSON.parse(fs.readFileSync(path.join(projectDir,"package.json"),"utf8")) as Record<string,unknown>;}catch{return[];}
  if(!fs.existsSync(path.join(projectDir,"node_modules")))return[];
  const declared=new Set(["dependencies","devDependencies","peerDependencies","optionalDependencies"]
    .flatMap(k=>Object.keys((manifest[k]??{}) as Record<string,unknown>)));
  const missing=new Set<string>();
  for(const m of content.matchAll(SPECIFIER)){
    const name=packageName(m[1]!);
    if(!name||declared.has(name)||name===manifest.name)continue;
    if(fs.existsSync(path.join(projectDir,"node_modules",...name.split("/"))))continue;
    missing.add(name);
  }
  return[...missing];
}

// ---------------------------------------------------------------- exports other files still import

const EXPORT_DECL=/^\s*export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST=/^\s*export\s*\{([^}]*)\}(?!\s*from)/gm;
/** The named exports of a module (not default, not re-exports). */
export function namedExports(content:string):Set<string>{
  const out=new Set<string>();
  for(const m of content.matchAll(EXPORT_DECL))out.add(m[1]!);
  for(const m of content.matchAll(EXPORT_LIST))for(const part of m[1]!.split(",")){const name=part.trim().split(/\s+as\s+/).pop()!.trim();if(name&&name!=="default")out.add(name);}
  return out;
}
const SOURCE=/\.(?:mjs|cjs|js|jsx|ts|tsx)$/i;
const SKIP_DIRS=new Set(["node_modules","dist","build",".git",".layanx",".next","coverage","out"]);
function sourceFiles(dir:string,limit=400):string[]{
  const out:string[]=[];
  const walk=(d:string)=>{if(out.length>=limit)return;let entries:fs.Dirent[]=[];try{entries=fs.readdirSync(d,{withFileTypes:true});}catch{return;}
    for(const e of entries){if(out.length>=limit)return;if(e.isDirectory()){if(!SKIP_DIRS.has(e.name)&&!e.name.startsWith("."))walk(path.join(d,e.name));}else if(SOURCE.test(e.name))out.push(path.join(d,e.name));}};
  walk(dir);return out;
}
function resolvesTo(fromFile:string,specifier:string,target:string):boolean{
  if(!specifier.startsWith("."))return false;
  const base=path.resolve(path.dirname(fromFile),specifier);
  const t=path.resolve(target).toLowerCase();
  return [base,...[".js",".jsx",".ts",".tsx",".mjs"].map(x=>base+x),...["index.js","index.jsx","index.ts","index.tsx"].map(x=>path.join(base,x))].some(c=>c.toLowerCase()===t);
}
const NAMED_IMPORT=/import\s+(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
/**
 * Names this write would remove from the module although another project file imports them by name: the build
 * (or the page) breaks. Seen live 2026-11-14: a repair rewrote components/ui.jsx without Sparkline, data.js without
 * people. Returns "file imports name" lines; empty when nothing breaks or the file is new.
 */
export function brokenImporters(projectDir:string,target:string,newContent:string):string[]{
  if(!SOURCE.test(target))return[];
  let before="";try{before=fs.readFileSync(target,"utf8");}catch{return[];}
  const now=namedExports(newContent);
  const removed=[...namedExports(before)].filter(n=>!now.has(n));
  if(!removed.length)return[];
  const out:string[]=[];
  for(const file of sourceFiles(projectDir)){
    if(path.resolve(file).toLowerCase()===path.resolve(target).toLowerCase())continue;
    let text="";try{text=fs.readFileSync(file,"utf8");}catch{continue;}
    for(const m of text.matchAll(NAMED_IMPORT)){
      if(!resolvesTo(file,m[2]!,target))continue;
      const names=m[1]!.split(",").map(p=>p.trim().split(/\s+as\s+/)[0]!.trim()).filter(Boolean);
      for(const n of names)if(removed.includes(n))out.push(`${path.relative(projectDir,file).split(path.sep).join("/")} imports ${n}`);
    }
  }
  return[...new Set(out)];
}
