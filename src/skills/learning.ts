import {createHash,randomUUID} from "node:crypto";
import {mkdirSync,readFileSync,writeFileSync,readdirSync} from "node:fs";
import {join,resolve} from "node:path";
import type {SkillManifest} from "./registry.js";
import {SkillScanner} from "./scanner.js";

export interface LearningTrace{missionId:string;projectId:string;goal:string;steps:Array<{tool:string;action:string;ok:boolean;error?:string}>;outcome:"success"|"failure";lesson?:string;}
export interface PendingSkill{ id:string; manifest:SkillManifest; content:string; createdAt:string; sourceMissionId:string; findings:ReturnType<SkillScanner["scan"]>; }

export class SkillLearningEngine{
 constructor(private readonly root=process.env.LAYANX_SKILL_LEARNING_DIR??".layanx/skills/pending",private readonly scanner=new SkillScanner()){}
 private dir(){return resolve(this.root)}
 private path(id:string){return join(this.dir(),id+".json")}
 propose(trace:LearningTrace):PendingSkill{
  if(!trace.goal.trim())throw new Error("Learning goal is empty.");
  const successful=trace.steps.filter(s=>s.ok);
  if(trace.outcome!=="success"||successful.length===0)throw new Error("Only successful, non-empty workflows can become skills.");
  const id="learned-"+randomUUID();
  const slug=trace.goal.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"workflow";
  const content=["# "+slug,"","## Purpose",trace.goal.trim(),"","## Procedure",...successful.map((s,i)=>`${i+1}. Use \`${s.tool}\` — ${s.action}`), "", "## Learned lesson",trace.lesson?.trim()||"Reuse the verified sequence; re-check tool results before proceeding.","","## Safety","This skill is a staged learning artifact. It is not enabled automatically. Review and test it before activation."].join("\n");
  const checksum=createHash("sha256").update(content).digest("hex");
  const manifest:SkillManifest={id,name:slug,version:"0.1.0",description:trace.goal.trim().slice(0,240),source:"agent-learning",license:"MIT",permissions:["L1_READ","L2_ANALYZE","L3_MODIFY"],tools:[...new Set(successful.map(s=>s.tool))],networkHosts:[],checksum,status:"quarantined"};
  const findings=this.scanner.scan(manifest);
  const contentLower=content.toLowerCase();
  const dangerousPatterns=[/ignore (all|previous|prior) instructions/,/send .*token|send .*password|exfiltrat/,/rm -rf|format c:/,/reverse shell|nc -e|curl .*\|.*sh/ ];
  for(const pattern of dangerousPatterns)if(pattern.test(contentLower))findings.findings.push({severity:"critical",code:"DANGEROUS_CONTENT",message:"Learned skill content matched a blocked security pattern: "+pattern.source});
  findings.safe=findings.safe&&!findings.findings.some(f=>f.severity==="high"||f.severity==="critical");
  const pending={id,manifest,content,createdAt:new Date().toISOString(),sourceMissionId:trace.missionId,findings};
  if(!findings.safe)throw new Error("Learned skill failed the security policy.");
  mkdirSync(this.dir(),{recursive:true});writeFileSync(this.path(id),JSON.stringify(pending,null,2)+"\n","utf8");
  return pending;
 }
 list():PendingSkill[]{try{return readdirSync(this.dir()).filter(x=>x.endsWith(".json")).map(x=>JSON.parse(readFileSync(join(this.dir(),x),"utf8")) as PendingSkill)}catch{return[]}}
 get(id:string){const p=this.path(id);try{return JSON.parse(readFileSync(p,"utf8")) as PendingSkill}catch{throw new Error("Unknown pending skill: "+id)}}
 approve(id:string){const item=this.get(id);if(!item.findings.safe)throw new Error("Skill cannot be approved while security findings block it.");const checksum=createHash("sha256").update(item.content).digest("hex");if(checksum!==item.manifest.checksum)throw new Error("Pending skill integrity checksum mismatch.");item.manifest.status="approved";writeFileSync(this.path(id),JSON.stringify(item,null,2)+"\n","utf8");return item}
 verify(id:string){const item=this.get(id);const checksum=createHash("sha256").update(item.content).digest("hex");if(checksum!==item.manifest.checksum)return false;const scan=this.scanner.scan(item.manifest);const lower=item.content.toLowerCase();const blocked=[/ignore (all|previous|prior) instructions/,/send .*token|send .*password|exfiltrat/,/rm -rf|format c:/,/reverse shell|nc -e|curl .*\|.*sh/];return scan.safe&&!blocked.some(pattern=>pattern.test(lower));}
 enable(id:string){const item=this.get(id);if(item.manifest.status!=="approved")throw new Error("Skill must be approved before enablement.");item.manifest.status="enabled";writeFileSync(this.path(id),JSON.stringify(item,null,2)+"\n","utf8");return item}
 reject(id:string){const item=this.get(id);writeFileSync(this.path(id),JSON.stringify({...item,rejectedAt:new Date().toISOString()},null,2)+"\n","utf8");return item}
}
