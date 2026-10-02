import type {ModelExecutionRouter} from "./model-execution.js";
import type {PermissionLevel} from "./types.js";

export interface DecomposedTask{
 id:string;
 description:string;
 capability:"chat"|"reasoning"|"coding"|"vision"|"embedding"|"audio";
 permission:PermissionLevel;
 dependencies:string[];
 successCriteria:string[];
}

export interface TaskDecomposition{
 goal:string;
 tasks:DecomposedTask[];
}

export class TaskDecomposer{
 constructor(private readonly models:ModelExecutionRouter){}
 async decompose(goal:string,projectContext?:unknown):Promise<TaskDecomposition>{
  if(!goal.trim())throw new Error("Task decomposition goal is empty.");
  const response=await this.models.execute({
   capability:"reasoning",
   input:[
    "You are the LayanX task decomposition engine.",
    "Return ONLY valid JSON with one key: tasks.",
    "tasks must be an array of independent executable subtasks.",
    "Each task must contain id, description, capability, permission, dependencies, successCriteria.",
    "Use unique short ids. dependencies must reference task ids.",
    "capability must be chat|reasoning|coding|vision|embedding|audio.",
    "permission must be L1_READ|L2_ANALYZE|L3_MODIFY|L4_EXECUTE|L5_CRITICAL.",
    "Keep the decomposition minimal: do not create unnecessary subtasks.",
    "Do not request secrets or bypass security controls.",
    "Project context: "+JSON.stringify(projectContext??null).slice(0,6000),
    "Goal: "+goal
   ].join("\n")
  });
  return this.parse(goal,response.output);
 }
 private parse(goal:string,raw:string):TaskDecomposition{
  let value:unknown;
  try{value=JSON.parse(raw);}catch{throw new Error("Task decomposer returned invalid JSON.");}
  if(!value||typeof value!=="object"||!Array.isArray((value as Record<string,unknown>).tasks))throw new Error("Task decomposer returned invalid tasks.");
  const rawTasks=(value as Record<string,unknown>).tasks as unknown[];
  if(!rawTasks.length)throw new Error("Task decomposition returned no tasks.");
  const ids=new Set<string>();
  const tasks=rawTasks.map((item,index)=>{
   if(!item||typeof item!=="object")throw new Error("Invalid decomposed task.");
   const t=item as Record<string,unknown>;
   const id=typeof t.id==="string"?t.id.trim():"";
   const description=typeof t.description==="string"?t.description.trim():"";
   const capability=t.capability;
   const permission=t.permission;
   const dependencies=Array.isArray(t.dependencies)?t.dependencies.filter(x=>typeof x==="string").map(String):[];
   const successCriteria=Array.isArray(t.successCriteria)?t.successCriteria.filter(x=>typeof x==="string"&&x.trim()).map(String):[];
   if(!id||ids.has(id))throw new Error("Decomposed task IDs must be unique.");
   if(!description)throw new Error("Decomposed task description is required.");
   if(!["chat","reasoning","coding","vision","embedding","audio"].includes(String(capability)))throw new Error("Invalid decomposed task capability.");
   if(!["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE","L5_CRITICAL"].includes(String(permission)))throw new Error("Invalid decomposed task permission.");
   if(!successCriteria.length)throw new Error("Each decomposed task requires success criteria.");
   ids.add(id);
   return{id,description,capability:capability as DecomposedTask["capability"],permission:permission as PermissionLevel,dependencies,successCriteria};
  });
  for(const task of tasks){
   for(const dependency of task.dependencies){
    if(dependency===task.id)throw new Error("A task cannot depend on itself.");
    if(!ids.has(dependency))throw new Error("Decomposed task has an unknown dependency: "+dependency);
   }
  }
  this.assertAcyclic(tasks);
  return{goal,tasks};
 }
 private assertAcyclic(tasks:DecomposedTask[]){
  const map=new Map(tasks.map(t=>[t.id,t.dependencies]));
  const visiting=new Set<string>(),visited=new Set<string>();
  const visit=(id:string)=>{
   if(visiting.has(id))throw new Error("Task decomposition contains a dependency cycle.");
   if(visited.has(id))return;
   visiting.add(id);
   for(const dependency of map.get(id)??[])visit(dependency);
   visiting.delete(id);visited.add(id);
  };
  for(const task of tasks)visit(task.id);
 }
}