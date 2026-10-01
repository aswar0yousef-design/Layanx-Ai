import type {ModelClient,ModelRequest,ModelResponse} from "./provider-client.js";
export interface CloudTransport{post(url:string,headers:Record<string,string>,body:unknown):Promise<{status:number;json:()=>Promise<any>}>;}
export class OpenAICompatibleClient implements ModelClient{
 constructor(private readonly provider:string,private readonly endpoint:string,private readonly secret:()=>Promise<string>){}
 async generate(request:ModelRequest):Promise<ModelResponse>{
  const key=await this.secret();
  const r=await fetch(this.endpoint,{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+key},body:JSON.stringify({model:request.model,messages:[{role:"user",content:request.input}],max_tokens:request.maxTokens,temperature:request.temperature})});
  if(!r.ok)throw new Error(this.provider+" provider returned HTTP "+r.status);
  const d=await r.json() as {choices?:Array<{message?:{content?:string}}>;usage?:{prompt_tokens?:number;completion_tokens?:number}};
  const output=d.choices?.[0]?.message?.content;if(typeof output!=="string")throw new Error(this.provider+" provider returned no text output.");
  const usage={...(typeof d.usage?.prompt_tokens==="number"?{inputTokens:d.usage.prompt_tokens}:{}),...(typeof d.usage?.completion_tokens==="number"?{outputTokens:d.usage.completion_tokens}:{})};
  return{provider:this.provider,model:request.model,output,usage};
 }
}
