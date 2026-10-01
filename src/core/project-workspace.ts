import type {ProjectState} from "../memory/project-state.js";
export interface ProjectWorkspace{project:ProjectState;memoryNamespace:string;skillIds:string[];toolNames:string[];config:Record<string,unknown>;}
export class ProjectWorkspaceManager{
 private readonly workspaces=new Map<string,ProjectWorkspace>();
 create(project:ProjectState):ProjectWorkspace{
  if(this.workspaces.has(project.id))throw new Error("Project workspace already exists.");
  const ws={project,memoryNamespace:"project:"+project.id,skillIds:[],toolNames:[],config:{}};
  this.workspaces.set(project.id,ws);return ws;
 }
 get(projectId:string){const ws=this.workspaces.get(projectId);if(!ws)throw new Error("Unknown project workspace.");return ws;}
 attachSkill(projectId:string,skillId:string){const ws=this.get(projectId);if(!ws.skillIds.includes(skillId))ws.skillIds.push(skillId);}
 attachTool(projectId:string,toolName:string){const ws=this.get(projectId);if(!ws.toolNames.includes(toolName))ws.toolNames.push(toolName);}
 setConfig(projectId:string,key:string,value:unknown){this.get(projectId).config[key]=value;}
}
