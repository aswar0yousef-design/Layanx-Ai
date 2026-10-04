import {readFile,readdir,stat} from "node:fs/promises";
import {resolve,relative,sep,extname,dirname,join} from "node:path";

export interface ProjectGraphOptions{root:string;maxFiles?:number;maxFileBytes?:number;}
export interface ProjectGraphNode{
  id:string;
  kind:"file"|"config"|"test"|"entry"|"route";
  path:string;
  category:string;
}
export interface ProjectGraphEdge{
  from:string;
  to:string;
  kind:"import"|"test"|"route";
}
export interface ProjectGraphResult{
  projectId:string;
  generatedAt:string;
  truncated:boolean;
  nodes:ProjectGraphNode[];
  edges:ProjectGraphEdge[];
  entryPoints:string[];
  routes:string[];
  tests:string[];
  dependencies:Record<string,string>;
}

const SKIP=new Set([".git","node_modules","dist","build","coverage",".next",".turbo",".cache",".idea",".vscode"]);
const EXT=new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".json",".css",".scss",".html",".md",".mdx",".sql",".py",".go",".rs",".java",".kt",".swift",".yml",".yaml",".sh"]);
const CODE_EXT=new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs"]);
const IMPORT_RE=/(?:import\s+(?:[^'"]+?\s+from\s+)?|export\s+(?:[^'"]+?\s+from\s+)?|require\s*\(|import\s*\()(['"])([^'"]+)\1/g;

export class ProjectGraph{
  private readonly root:string;
  private readonly maxFiles:number;
  private readonly maxFileBytes:number;
  constructor(options:ProjectGraphOptions){
    this.root=resolve(options.root);
    this.maxFiles=Math.min(Math.max(options.maxFiles??1000,100),5000);
    this.maxFileBytes=Math.min(Math.max(options.maxFileBytes??512*1024,16*1024),2*1024*1024);
  }

  async scan(projectId:string):Promise<ProjectGraphResult>{
    const workspace=this.workspaceFor(projectId);
    const files:string[]=[];
    let truncated=false;
    const walk=async(dir:string):Promise<void>=>{
      if(files.length>=this.maxFiles){truncated=true;return;}
      const entries=await readdir(dir,{withFileTypes:true});
      for(const entry of entries){
        if(files.length>=this.maxFiles){truncated=true;break;}
        if(entry.name.startsWith(".")&&entry.name!==".env.example")continue;
        if(entry.isDirectory()){
          if(SKIP.has(entry.name)||entry.isSymbolicLink())continue;
          await walk(resolve(dir,entry.name));
        }else if(entry.isFile()&&!entry.isSymbolicLink()&&EXT.has(extname(entry.name).toLowerCase())){
          files.push(relative(workspace,resolve(dir,entry.name)).split(sep).join("/"));
        }
      }
    };
    await walk(workspace);
    files.sort();

    const fileSet=new Set(files);
    const nodes:ProjectGraphNode[]=files.map(path=>{
      const lower=path.toLowerCase();
      const category=extname(path).toLowerCase()||"other";
      const kind:ProjectGraphNode["kind"]=/(^|\/)(test|tests|__tests__)(\/)|\.(spec|test)\./i.test(path)
        ?"test"
        :/^(tsconfig(?:\..*)?\.json|package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|vite\.config\.[^/]+|next\.config\.[^/]+)$/i.test(path)
          ?"config"
          :/^(src\/)?(index|main|server|app)\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)
            ?"entry":"file";
      return{id:path,kind,path,category};
    });
    const edges:ProjectGraphEdge[]=[];
    const routes:string[]=[];
    const tests=nodes.filter(node=>node.kind==="test").map(node=>node.path);
    const entryPoints=nodes.filter(node=>node.kind==="entry").map(node=>node.path);

    for(const path of files){
      if(!CODE_EXT.has(extname(path).toLowerCase()))continue;
      const absolute=resolve(workspace,path);
      let source:string;
      try{
        const info=await stat(absolute);
        if(info.size>this.maxFileBytes)continue;
        source=await readFile(absolute,"utf8");
      }catch{continue;}
      let match:RegExpExecArray|null;
      while((match=IMPORT_RE.exec(source))!==null){
        const specifier=match[2];
        if(typeof specifier!=="string"||!specifier.startsWith("."))continue;
        const target=this.resolveImport(path,specifier,fileSet);
        if(target)edges.push({from:path,to:target,kind:"import"});
      }
      IMPORT_RE.lastIndex=0;
      if(/(?:app|router|route|api).{0,80}(?:get|post|put|patch|delete|options|head)\s*\(/i.test(source)||
         /(?:app|router)\\.(?:get|post|put|patch|delete)\s*\(/i.test(source)){
        nodes.push({id:"route:"+path,kind:"route",path,category:"route"});
        routes.push(path);
      }
    }

    for(const test of tests){
      const testBase=test.replace(/\.(spec|test)(?=\.[^.]+$)/i,"");
      const candidate=files.find(file=>file===testBase||file.startsWith(testBase+"/")||file.replace(/\.[^.]+$/,"")===testBase);
      if(candidate&&candidate!==test)edges.push({from:test,to:candidate,kind:"test"});
    }

    const packagePath=resolve(workspace,"package.json");
    const dependencies:Record<string,string>={};
    try{
      const parsed=JSON.parse(await readFile(packagePath,"utf8")) as Record<string,unknown>;
      for(const key of ["dependencies","devDependencies"]){
        const value=parsed[key];
        if(value&&typeof value==="object"&&!Array.isArray(value)){
          for(const [name,version] of Object.entries(value as Record<string,unknown>))
            if(typeof version==="string")dependencies[name]=version;
        }
      }
    }catch{}

    return{projectId,generatedAt:new Date().toISOString(),truncated,nodes,edges,entryPoints,routes,tests,dependencies};
  }

  private resolveImport(from:string,specifier:string,files:Set<string>):string|undefined{
    const base=dirname(from).split(sep).join("/");
    const raw=join(base,specifier).split(sep).join("/").replace(/^\.\//,"");
    const sourceLike=raw.replace(/\.(?:js|jsx|mjs|cjs)$/,"");
    const candidates=[raw,sourceLike,...[".ts",".tsx",".js",".jsx",".mjs",".cjs"].flatMap(ext=>[raw+ext,sourceLike+ext]),...["index.ts","index.tsx","index.js","index.jsx","index.mjs","index.cjs"].map(name=>raw+"/"+name),...["index.ts","index.tsx","index.js","index.jsx","index.mjs","index.cjs"].map(name=>sourceLike+"/"+name)];
    return candidates.find(candidate=>files.has(candidate));
  }

  private workspaceFor(projectId:string):string{
    const safe=projectId.trim();
    if(!safe||safe==="."||safe===".."||safe.includes("/")||safe.includes("\\"))throw new Error("Invalid project workspace identity.");
    return resolve(this.root,safe);
  }
}
