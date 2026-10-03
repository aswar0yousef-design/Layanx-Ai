import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolRequest} from "../core/types.js";

function obj(v:unknown){return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{}}
function str(v:unknown,name:string){if(typeof v!=="string"||!v.trim())throw new Error(name+" is required.");return v.trim()}

export function registerSkillLearningTools(core:LayanXCore){
 const defs=[
  ["skill.learn","stage a reusable skill from a successful mission trace; never enable it automatically","L3_MODIFY",false],
  ["skill.pending","list staged learned skills awaiting review","L1_READ",false],
  ["skill.approve","approve a staged learned skill after security review","L3_MODIFY",false],
  ["skill.enable","enable an already approved learned skill","L3_MODIFY",false]
 ] as const;
 for(const [name,description,permission,dangerous] of defs){
  core.tools.register({name,description,permission,dangerous,actions:[name],tags:["skills","learning","self-improvement"]});
  core.toolAdapters.register(name,{async execute(request:ToolRequest){
   const p=obj(request.payload);
   if(name==="skill.learn"){
    const steps=Array.isArray(p.steps)?p.steps.map((step)=>{
     const x=obj(step);return{tool:str(x.tool,"step.tool"),action:str(x.action,"step.action"),ok:x.ok===true,error:typeof x.error==="string"?x.error:undefined};
    }):[];
    return core.learnSkill({missionId:str(p.missionId,"missionId"),projectId:str(p.projectId,"projectId"),goal:str(p.goal,"goal"),steps,outcome:p.outcome==="success"?"success":"failure",lesson:typeof p.lesson==="string"?p.lesson:undefined});
   }
   if(name==="skill.pending")return core.skillLearning.list().map(item=>({id:item.id,name:item.manifest.name,description:item.manifest.description,sourceMissionId:item.sourceMissionId,createdAt:item.createdAt,safe:item.findings.safe,findings:item.findings.findings}));
   const id=str(p.id,"id");
   if(name==="skill.approve")return core.approveLearnedSkill(id);
   return core.enableLearnedSkill(id);
  }});
 }
}
