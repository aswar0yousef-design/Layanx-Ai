import {readFile,readdir,stat} from "node:fs/promises";
import {resolve,relative,sep,extname,basename} from "node:path";

export interface ProjectIntelligenceOptions{
  root:string;
  maxFiles?:number;
  maxDepth?:number;
  maxMetadataBytes?:number;
  cacheTtlMs?:number;
}

export interface ProjectFileSummary{
  path:string;
  type:"file";
  size:number;
  extension:string;
  category:string;
}

export interface ProjectIntelligenceResult{
  projectId:string;
  generatedAt:string;
  cached:boolean;
  summary:{
    totalFiles:number;
    truncated:boolean;
    languages:Record<string,number>;
    categories:Record<string,number>;
  };
  markers:{
    packageJson:boolean;
    tsconfig:boolean;
    readme:boolean;
    git:boolean;
    tests:boolean;
    src:boolean;
    entryPoints:string[];
  };
  package?:{
    name?:string;
    version?:string;
    scripts:string[];
    dependencies:number;
    devDependencies:number;
  };
  files:ProjectFileSummary[];
}

interface CacheEntry{
  expiresAt:number;
  result:ProjectIntelligenceResult;
  markersFingerprint:string;
}

const SKIP_DIRECTORIES=new Set([".git","node_modules","dist","build","coverage",".next",".turbo",".cache",".idea",".vscode"]);
const EXTENSION_CATEGORY:Record<string,string>={
  ".ts":"typescript",".tsx":"typescript",".js":"javascript",".jsx":"javascript",
  ".mjs":"javascript",".cjs":"javascript",".json":"json",".css":"css",".scss":"css",
  ".html":"html",".md":"markdown",".mdx":"markdown",".sql":"sql",".py":"python",
  ".go":"go",".rs":"rust",".java":"java",".kt":"kotlin",".swift":"swift",
  ".yml":"yaml",".yaml":"yaml",".sh":"shell"
};

export class ProjectIntelligence{
  private readonly root:string;
  private readonly maxFiles:number;
  private readonly maxDepth:number;
  private readonly maxMetadataBytes:number;
  private readonly cacheTtlMs:number;
  private readonly cache=new Map<string,CacheEntry>();

  constructor(options:ProjectIntelligenceOptions){
    this.root=resolve(options.root);
    this.maxFiles=Math.min(Math.max(options.maxFiles??500,50),2000);
    this.maxDepth=Math.min(Math.max(options.maxDepth??8,2),16);
    this.maxMetadataBytes=Math.min(Math.max(options.maxMetadataBytes??256*1024,16*1024),1024*1024);
    this.cacheTtlMs=Math.min(Math.max(options.cacheTtlMs??5000,0),60000);
  }

  invalidate(projectId:string):void{
    this.cache.delete(this.workspaceKey(projectId));
  }

  async scan(projectId:string):Promise<ProjectIntelligenceResult>{
    const workspace=this.workspaceFor(projectId);
    const key=this.workspaceKey(projectId);
    const now=Date.now();
    const fingerprint=await this.markerFingerprint(workspace);
    const cached=this.cache.get(key);
    if(cached&&cached.expiresAt>now&&cached.markersFingerprint===fingerprint){
      return{...cached.result,cached:true};
    }

    const files:ProjectFileSummary[]=[];
    const languages:Record<string,number>={};
    const categories:Record<string,number>={};
    let truncated=false;

    const walk=async(directory:string,depth:number):Promise<void>=>{
      if(depth>this.maxDepth||files.length>=this.maxFiles){
        truncated=true;
        return;
      }
      const entries=await readdir(directory,{withFileTypes:true});
      for(const entry of entries){
        if(files.length>=this.maxFiles){truncated=true;break;}
        if(entry.name.startsWith(".")&&entry.name!==".env.example")continue;
        if(entry.isDirectory()){
          if(SKIP_DIRECTORIES.has(entry.name))continue;
          if(entry.isSymbolicLink())continue;
          await walk(resolve(directory,entry.name),depth+1);
          continue;
        }
        if(!entry.isFile()||entry.isSymbolicLink())continue;
        const absolute=resolve(directory,entry.name);
        const info=await stat(absolute);
        const path=relative(workspace,absolute).split(sep).join("/");
        const extension=extname(entry.name).toLowerCase();
        const category=EXTENSION_CATEGORY[extension]??(basename(entry.name).startsWith(".")?"config":"other");
        files.push({path,type:"file",size:info.size,extension,category});
        languages[category]=(languages[category]??0)+1;
        categories[category]=(categories[category]??0)+1;
      }
    };

    await walk(workspace,0);
    files.sort((a,b)=>a.path.localeCompare(b.path));

    const packageInfo=await this.readPackageJson(workspace);
    const markers={
      packageJson:files.some(file=>file.path==="package.json"),
      tsconfig:files.some(file=>file.path==="tsconfig.json"||file.path==="tsconfig.base.json"),
      readme:files.some(file=>/^README(?:\\..+)?$/i.test(file.path)),
      git:await this.exists(resolve(workspace,".git")),
      tests:files.some(file=>/(^|\\/)(test|tests|__tests__)\\//i.test(file.path)||/\\.(spec|test)\\.[^.]+$/i.test(file.path)),
      src:files.some(file=>/^src\\//i.test(file.path)),
      entryPoints:files.filter(file=>/^(src\\/)?(index|main|server|app)\\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file.path)).slice(0,20).map(file=>file.path)
    };

    const result:ProjectIntelligenceResult={
      projectId,generatedAt:new Date().toISOString(),cached:false,
      summary:{totalFiles:files.length,truncated,languages,categories},
      markers,
      ...(packageInfo?{package:packageInfo}:{}),
      files
    };
    this.cache.set(key,{expiresAt:now+this.cacheTtlMs,result,markersFingerprint:fingerprint});
    return result;
  }

  private workspaceKey(projectId:string):string{
    return projectId.trim();
  }

  private workspaceFor(projectId:string):string{
    const safe=projectId.trim();
    if(!safe||safe==="."||safe===".."||safe.includes("/")||safe.includes("\\\\"))throw new Error("Invalid project workspace identity.");
    return resolve(this.root,safe);
  }

  private async exists(path:string):Promise<boolean>{
    try{await stat(path);return true;}catch{return false;}
  }

  private async markerFingerprint(workspace:string):Promise<string>{
    const names=["package.json","tsconfig.json","tsconfig.base.json","README.md","README","src"];
    const parts:string[]=[];
    for(const name of names){
      try{
        const info=await stat(resolve(workspace,name));
        parts.push(name+":"+info.mtimeMs+":"+info.size+":"+info.mode);
      }catch{
        parts.push(name+":missing");
      }
    }
    return parts.join("|");
  }

  private async readPackageJson(workspace:string):Promise<ProjectIntelligenceResult["package"]|undefined>{
    const path=resolve(workspace,"package.json");
    try{
      const info=await stat(path);
      if(!info.isFile()||info.size>this.maxMetadataBytes)return undefined;
      const parsed=JSON.parse(await readFile(path,"utf8")) as Record<string,unknown>;
      const scripts=parsed.scripts&&typeof parsed.scripts==="object"&&!Array.isArray(parsed.scripts)
        ?Object.keys(parsed.scripts as Record<string,unknown>).sort():[];
      const dependencies=parsed.dependencies&&typeof parsed.dependencies==="object"&&!Array.isArray(parsed.dependencies)
        ?Object.keys(parsed.dependencies as Record<string,unknown>).length:0;
      const devDependencies=parsed.devDependencies&&typeof parsed.devDependencies==="object"&&!Array.isArray(parsed.devDependencies)
        ?Object.keys(parsed.devDependencies as Record<string,unknown>).length:0;
      return{
        ...(typeof parsed.name==="string"?{name:parsed.name}:{}),
        ...(typeof parsed.version==="string"?{version:parsed.version}:{}),
        scripts,dependencies,devDependencies
      };
    }catch{
      return undefined;
    }
  }
}
