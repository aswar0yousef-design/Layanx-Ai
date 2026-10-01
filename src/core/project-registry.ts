import type {ProjectState} from "../memory/project-state.js";
export class ProjectRegistry{
 private readonly projects=new Map<string,ProjectState>();
 register(project:ProjectState){if(this.projects.has(project.id))throw new Error("Project already registered.");this.projects.set(project.id,project);}
 get(id:string){const p=this.projects.get(id);if(!p)throw new Error("Unknown project.");return p;}
 list(){return[...this.projects.values()];}
 update(id:string,patch:Partial<ProjectState>){const current=this.get(id);const next={...current,...patch,updatedAt:new Date().toISOString()};this.projects.set(id,next);return next;}
}
