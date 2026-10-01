import type {ModelClient,ModelRequest,ModelResponse} from "./provider-client.js";
export class LocalHttpModelClient implements ModelClient{
 constructor(private readonly baseUrl:string){}
 async generate(request:ModelRequest):Promise<ModelResponse>{
  const response=await fetch(this.baseUrl+"/generate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:request.model,prompt:request.input,max_tokens:request.maxTokens,temperature:request.temperature})});
  if(!response.ok)throw new Error("Local model provider returned HTTP "+response.status);
  const data=await response.json() as {response?:string;output?:string};
  const output=data.response??data.output;
  if(typeof output!=="string")throw new Error("Local model provider returned no text output.");
  return{provider:"local",model:request.model,output};
 }
}
