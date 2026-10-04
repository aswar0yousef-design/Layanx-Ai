export interface ProjectResource{projectId:string;resourceId:string;}
export class ProjectIsolation{
 normalize(projectId:string):string{
  const normalized=projectId.trim();
  if(!normalized)throw new Error("Project id is required.");
  return normalized;
 }
 assertSameProject(projectId:string,resource:ProjectResource){
  const expected=this.normalize(projectId);
  if(resource.projectId!==expected)throw new Error("Project isolation scope violation.");
 }
 assertMissionProject(projectId:string,missionProjectId:string|undefined){
  const expected=this.normalize(projectId);
  if(!missionProjectId)throw new Error("Mission is not bound to a project.");
  if(missionProjectId!==expected)throw new Error("Project isolation scope violation.");
 }
 assertMemoryNamespace(projectId:string,namespace:string){
  if(namespace!=="project:"+this.normalize(projectId))throw new Error("Invalid project memory namespace.");
 }
}
