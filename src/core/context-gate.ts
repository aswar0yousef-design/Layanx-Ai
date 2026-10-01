import type {ContextResolver,ContextRequest} from "../memory/context.js";
export class ContextGate{
 constructor(private readonly resolver:ContextResolver){}
 async load(request:ContextRequest){return this.resolver.resolve(request);}
}
