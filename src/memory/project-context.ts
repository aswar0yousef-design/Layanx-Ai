import type {ContextResolver,ContextRequest} from "./context.js";
export class ProjectContextResolver{
 constructor(private readonly resolver:ContextResolver){}
 async resolve(projectId:string,query:string,limit=20){
  return this.resolver.resolve({projectId,query,limit});
 }
}
