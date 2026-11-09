import {randomBytes} from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {isTaskListApp,type ProjectJobView,type ProjectStart,type ProjectWork} from "../voice/project-intent.js";
import {projectDir} from "./project-dir.js";
import {STATIC_REPAIR_PROFILE,isStaticWebProject} from "./repair-engine.js";
import type {Supervisor,SupervisorJob} from "./supervisor.js";

const ACTIVE=new Set(["queued","planning","running","verifying","waiting_approval"]);
export function jobView(job:SupervisorJob):ProjectJobView{
  const step=job.milestones[job.current];
  return{id:job.id,projectId:job.projectId,goal:job.goal,status:job.status,stepNumber:Math.min(job.current+1,job.milestones.length||1),totalSteps:job.milestones.length,...(step?{step:step.title}:{}),...(job.result?{result:job.result}:{}),
    handoffs:job.modelRun?.handoffs.length??0,verified:job.status==="completed"&&job.outcome?.status==="verified"};
}
const isDirectory=(dir:string)=>{try{return fs.statSync(dir).isDirectory();}catch{return false;}};
/** Only a project the owner opened or named. A guess here would change the wrong folder. */
function existingProject(text:string,current:string,env:NodeJS.ProcessEnv):string|undefined{
  if(current&&current!=="default"&&isDirectory(projectDir(current,env)))return current;
  const root=path.resolve(env.LAYANX_WORKSPACE_ROOT??process.cwd());
  const lower=text.toLowerCase();
  let names:string[]=[];
  try{names=fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name.length>=3&&!e.name.startsWith(".")).map(e=>e.name);}catch{return undefined;}
  const named=names.filter(name=>lower.includes(name.toLowerCase()));
  return named.length===1?named[0]:undefined;
}
export function chatProjects(supervisor:Pick<Supervisor,"create"|"list">,env:NodeJS.ProcessEnv=process.env){
  return{
    startProject(goal:string,work:ProjectWork,projectId:string):ProjectStart{
      // A repeated voice command or double send must not start the same work twice.
      const running=supervisor.list().find(job=>job.goal===goal&&ACTIVE.has(job.status));
      if(running)return{started:jobView(running),alreadyRunning:true};
      if(work==="repair"){
        const existing=existingProject(goal,projectId,env);
        if(!existing)return{needsProject:true};
        return{started:jobView(supervisor.create(goal,existing,isStaticWebProject(projectDir(existing,env))?{acceptanceProfile:STATIC_REPAIR_PROFILE}:{}))};
      }
      const slug=(goal.toLowerCase().match(/[a-z0-9]+/g)??[]).slice(0,3).join("-")||"project";
      const folder=`chat-${slug}-${randomBytes(3).toString("hex")}`;
      return{started:jobView(supervisor.create(goal,folder,isTaskListApp(goal)?{acceptanceProfile:"task-app-http-v1"}:{}))};
    },
    projectStatus(projectId:string):ProjectJobView|undefined{
      const jobs=supervisor.list();
      const job=(projectId&&projectId!=="default"?jobs.find(j=>j.projectId===projectId):undefined)??jobs[0];
      return job?jobView(job):undefined;
    }
  };
}
