export interface ProjectResource{projectId:string;resourceId:string;}
export class ProjectIsolation{
 assertSameProject(projectId:string,resource:ProjectResource){
  if(resource.projectId!==projectId)throw new Error("Project isolation violation.");
 }
 assertMemoryNamespace(projectId:string,namespace:string){
  if(namespace!=="project:"+projectId)throw new Error("Invalid project memory namespace.");
 }
}
