/** Local, inspectable delivery manifest. Does not package or upload project files. */
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import type {OutcomeReport} from "./outcome.js";

export interface DeliveryArtifact {path:string;bytes:number;sha256:string|null}
export interface DeliveryManifest {
  version:1;
  jobId:string;
  projectRoot:string;
  outcomeReference:string;
  verificationScope:"automated-gates";
  createdAt:string;
  artifacts:DeliveryArtifact[];
  commands:string[];
}
const skipDirs=new Set(["node_modules",".git",".layanx",".next",".cache","coverage"]);
const privateName=/(^\.env(?:\.|$)|secrets?|credentials?|password|token|private[-_.]?key|^id_rsa|\.pem$|\.p12$|\.pfx$|\.key$|\.sqlite$|\.db$)/i;
function inventory(root:string):DeliveryArtifact[]{
  const files:DeliveryArtifact[]=[];
  const visit=(dir:string)=>{
    if(files.length>=500)return;
    const entries=fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      if(files.length>=500)break;
      if(privateName.test(entry.name)||entry.isSymbolicLink())continue;
      const abs=path.join(dir,entry.name);
      if(entry.isDirectory()){if(!skipDirs.has(entry.name))visit(abs);continue;}
      if(!entry.isFile())continue;
      const stat=fs.statSync(abs);
      const rel=path.relative(root,abs).replace(/\\/g,"/");
      let sha256:string|null=null;
      if(stat.size<=8*1024*1024)sha256=createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
      files.push({path:rel,bytes:stat.size,sha256});
    }
  };
  visit(root);
  return files;
}
function runCommands(root:string):string[]{
  const packageFile=path.join(root,"package.json");
  if(!fs.existsSync(packageFile))return [];
  let pkg:unknown;
  try{pkg=JSON.parse(fs.readFileSync(packageFile,"utf8"));}catch{return [];}
  if(!pkg||typeof pkg!=="object")return [];
  const scripts=(pkg as {scripts?:unknown}).scripts;
  if(!scripts||typeof scripts!=="object")return [];
  const commands=[fs.existsSync(path.join(root,"package-lock.json"))?"npm ci":"npm install"];
  for(const name of ["test","build","start","dev"]){
    if(typeof (scripts as Record<string,unknown>)[name]==="string")commands.push("npm run "+name);
  }
  return commands;
}
/** Only successful automated gates may produce a successful delivery manifest. */
export function writeDeliveryManifest(projectRoot:string,jobId:string,outcome:OutcomeReport):{
  manifest:DeliveryManifest;relativePath:string;guideRelativePath:string
}{
  if(outcome.status!=="verified"||outcome.jobId!==jobId)
    throw Error("A matching verified outcome is required before delivery");
  const root=fs.realpathSync(projectRoot);
  if(!fs.statSync(root).isDirectory())throw Error("Project workspace is not a directory");
  if(!/^[a-zA-Z0-9-]{1,100}$/.test(jobId))throw Error("Invalid delivery job ID");
  const relativePath=".layanx/deliveries/"+jobId+".json";
  const target=path.join(root,...relativePath.split("/"));
  const manifest:DeliveryManifest={
    version:1,jobId,projectRoot:root,
    outcomeReference:".layanx/outcomes/"+jobId+".json",
    verificationScope:"automated-gates",
    createdAt:new Date().toISOString(),
    artifacts:inventory(root),commands:runCommands(root)
  };
  if(!manifest.artifacts.length)throw Error("No deliverable project files found");
  fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  const tmp=target+".tmp";
  try{
    fs.writeFileSync(tmp,JSON.stringify(manifest,null,2),{mode:0o600});
    fs.renameSync(tmp,target);
  }finally{if(fs.existsSync(tmp))fs.rmSync(tmp,{force:true});}
  const guideRelativePath=".layanx/deliveries/"+jobId+".md";
  const guide=path.join(root,...guideRelativePath.split("/"));
  const safe=(v:string)=>v.replace(/[\u0000-\u001F\u007F]/g," ").replace(/[`]/g,"'");
  const lines=[
    "# LayanX verified delivery",
    "",
    "Project: "+safe(root),
    "Job: "+jobId,
    "Scope: automated checks only. Natural-language acceptance criteria are NOT individually certified.",
    "Evidence report: "+manifest.outcomeReference,
    "",
    "## Suggested local commands (review before executing)",
    ...manifest.commands.map(command=>"- "+command),
    "",
    "## Project files",
    ...manifest.artifacts.map(file=>"- "+safe(file.path)+" ("+file.bytes+" bytes"+(file.sha256?", SHA-256 "+file.sha256:"")+")"),
    "",
    "Only indexed files are listed. Files with sensitive-looking names, symlinks, dependencies, and project metadata are excluded."
  ];
  const guideTmp=guide+".tmp";
  try{
    fs.writeFileSync(guideTmp,lines.join("\n")+"\n",{mode:0o600});
    fs.renameSync(guideTmp,guide);
  }finally{if(fs.existsSync(guideTmp))fs.rmSync(guideTmp,{force:true});}
  return {manifest,relativePath,guideRelativePath};
}
