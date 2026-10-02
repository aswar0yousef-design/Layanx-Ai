import {mkdtemp,mkdir,rm,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {ProjectIntelligence} from "../src/core/project-intelligence.js";

const root=await mkdtemp(join(process.cwd(),"project-intelligence-test-"));
const project=join(root,"project-a");
await mkdir(join(project,"src"),{recursive:true});
await mkdir(join(project,"tests"),{recursive:true});
await mkdir(join(project,".git"),{recursive:true});
await mkdir(join(project,"node_modules","ignored"),{recursive:true});
await writeFile(join(project,"package.json"),JSON.stringify({
  name:"project-a",version:"1.0.0",
  scripts:{test:"npm test",build:"tsc"},
  dependencies:{pg:"1.0"},devDependencies:{typescript:"1.0"}
}));
await writeFile(join(project,"tsconfig.json"),"{}");
await writeFile(join(project,"README.md"),"# Project A\n");
await writeFile(join(project,"src","index.ts"),"export const ok=true;\n");
await writeFile(join(project,"tests","index.spec.ts"),"test();\n");
await writeFile(join(project,"node_modules","ignored","bad.ts"),"should not be scanned");

const intelligence=new ProjectIntelligence({root,cacheTtlMs:30000,maxFiles:50});
const first=await intelligence.scan("project-a");
if(first.cached)throw new Error("First scan must not be cached.");
if(!first.markers.packageJson||!first.markers.tsconfig||!first.markers.readme||!first.markers.git||!first.markers.tests||!first.markers.src)throw new Error("Project markers were not detected.");
if(first.package?.name!=="project-a"||first.package.dependencies!==1||first.package.devDependencies!==1)throw new Error("package.json metadata was not summarized.");
if(!first.markers.entryPoints.includes("src/index.ts"))throw new Error("Entry point was not detected.");
if(first.files.some(file=>file.path.includes("node_modules")))throw new Error("Ignored directories were scanned.");
if(first.summary.totalFiles!==5)throw new Error("Unexpected bounded inventory size.");

const second=await intelligence.scan("project-a");
if(!second.cached)throw new Error("Second scan should use the bounded cache.");

await writeFile(join(project,"src","new.ts"),"export const newer=true;\n");
const third=await intelligence.scan("project-a");
if(third.cached||!third.files.some(file=>file.path==="src/new.ts"))throw new Error("Relevant project changes did not invalidate the cache.");

await intelligence.scan("../project-a").then(()=>{throw new Error("Project traversal was not blocked.");}).catch(error=>{
  if(!String(error).includes("Invalid project workspace identity"))throw error;
});

await rm(root,{recursive:true,force:true});
console.log("Project intelligence tests passed.");
