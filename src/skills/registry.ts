import type {PermissionLevel} from "../core/types.js";

export type SkillStatus="discovered"|"quarantined"|"testing"|"approved"|"enabled"|"disabled"|"rejected";
export interface SkillManifest{id:string;name:string;version:string;description:string;source:string;license?:string;permissions:PermissionLevel[];tools:string[];networkHosts:string[];checksum:string;status:SkillStatus;}
export class SkillRegistry{
 private readonly skills=new Map<string,SkillManifest>();
 register(skill:SkillManifest){if(this.skills.has(skill.id))throw new Error("Skill already registered.");if(skill.status==="enabled")throw new Error("New skills cannot be enabled before review.");this.skills.set(skill.id,{...skill,status:"quarantined"});}
 approve(id:string){const s=this.get(id);this.skills.set(id,{...s,status:"approved"});}
 enable(id:string){const s=this.get(id);if(s.status!=="approved")throw new Error("Skill must be approved before enablement.");this.skills.set(id,{...s,status:"enabled"});}
 disable(id:string){const s=this.get(id);this.skills.set(id,{...s,status:"disabled"});}
 get(id:string){const s=this.skills.get(id);if(!s)throw new Error("Unknown skill: "+id);return s;}
 list(){return[...this.skills.values()];}
 recommend(goal:string,limit=5){
  const query=goal.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]{2,}/gu)??[];
  const stop=new Set(["the","and","for","with","from","that","this","into","make","create","build","please","task","المطلوب","من","الى","إلى","على","في","عن","هذا","هذه","قم","بعمل","انشاء","إنشاء","عمل","اريد","أريد"]);
  const terms=[...new Set(query.filter(word=>!stop.has(word)))].slice(0,24);
  if(!terms.length)return[];
  const ranked=[...this.skills.values()].filter(skill=>skill.status==="enabled").map(skill=>{
   const fields=[skill.id,skill.name,skill.description,...skill.tools].join(" ").normalize("NFKC").toLowerCase();
   const matched=terms.filter(term=>fields.includes(term));
   const score=matched.reduce((sum,term)=>sum+(skill.tools.some(tool=>tool.toLowerCase().includes(term))?3:skill.name.toLowerCase().includes(term)?2:1),0);
   return{skill,score,matched};
  }).filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.skill.name.localeCompare(b.skill.name)).slice(0,Math.max(1,Math.min(10,Math.floor(limit)||5)));
  return ranked.map(({skill,score,matched})=>({id:skill.id,name:skill.name,description:skill.description,tools:skill.tools,score,matchedTerms:matched,status:skill.status,source:skill.source}));
 }
}
