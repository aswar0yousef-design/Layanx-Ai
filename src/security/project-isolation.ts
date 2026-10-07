import {linkedProjectPath} from "../platform/linked-projects.js";
import {resolve,relative,sep} from "node:path";

export interface ProjectResource{projectId:string;resourceId:string;}
const PROJECT_ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export class ProjectIsolation{
 normalize(projectId:string):string{
  const normalized=projectId.trim();
  if(!normalized)throw new Error("Project id is required.");
  if(!PROJECT_ID.test(normalized))throw new Error("Invalid project workspace identity.");
  return normalized;
 }
 canonical(projectId:string):string{
  const normalized=this.normalize(projectId);
  return process.platform==="win32"?normalized.toLowerCase():normalized;
 }
 assertSameProject(projectId:string,resource:ProjectResource){
  const expected=this.canonical(projectId);
  if(this.canonical(resource.projectId)!==expected)throw new Error("Project isolation scope violation.");
 }
 assertMissionProject(projectId:string,missionProjectId:string|undefined){
  const expected=this.canonical(projectId);
  if(!missionProjectId)throw new Error("Mission is not bound to a project.");
  if(this.canonical(missionProjectId)!==expected)throw new Error("Project isolation scope violation.");
 }
 assertMemoryNamespace(projectId:string,namespace:string){
  if(namespace!=="project:"+this.canonical(projectId))throw new Error("Invalid project memory namespace.");
 }
 assertRequestProject(projectId:string,requestProjectId:string|undefined){
  const expected=this.canonical(projectId);
  if(!requestProjectId)throw new Error("Tool request is not bound to a project.");
  if(this.canonical(requestProjectId)!==expected)throw new Error("Project isolation scope violation.");
 }
 workspacePath(root:string,projectId:string):string{
  const linked=linkedProjectPath(this.canonical(projectId));
  if(linked)return linked;
  const base=resolve(root),workspace=resolve(base,this.canonical(projectId)),rel=relative(base,workspace);
  if(!rel||rel===".."||rel.startsWith(".."+sep)||rel.includes("\0"))throw new Error("Project workspace escapes the configured root.");
  return workspace;
 }
}
