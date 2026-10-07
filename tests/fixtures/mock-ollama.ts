import http from "node:http";

export const GB=1024**3;

export interface MockModel{name:string;size:number;parameter_size:string;family?:string;capabilities?:string[];context?:number}
/** A queued reply: "404" -> model-not-found error, string -> assistant content, object -> merged into message. */
export type MockReply=string|Record<string,unknown>;
export interface MockOllama{
  url:string;
  calls:Array<{path:string;body:any}>;
  replies:Map<string,MockReply[]>;
  close():Promise<void>;
}

/** Minimal stand-in for the Ollama HTTP API used by the tests. */
export async function startMockOllama(models:MockModel[],options:{toolRejecting?:string[]}={}):Promise<MockOllama>{
  const calls:Array<{path:string;body:any}>=[];
  const replies=new Map<string,MockReply[]>();
  const toolRejecting=new Set(options.toolRejecting??[]);
  const server=http.createServer((req,res)=>{
    let raw="";
    req.on("data",c=>raw+=c);
    req.on("end",()=>{
      const body=raw?JSON.parse(raw):undefined;
      calls.push({path:req.url??"",body});
      const send=(status:number,data:unknown)=>{res.writeHead(status,{"content-type":"application/json"});res.end(JSON.stringify(data));};
      if(req.url==="/api/version")return send(200,{version:"0.12.0"});
      if(req.url==="/api/tags")return send(200,{models:models.map(m=>({name:m.name,model:m.name,size:m.size,details:{family:m.family??"",parameter_size:m.parameter_size,quantization_level:"Q4_K_M"}}))});
      if(req.url==="/api/ps")return send(200,{models:[]});
      if(req.url==="/api/show"){
        const m=models.find(x=>x.name===body.model);
        if(!m)return send(404,{error:"model not found"});
        return send(200,{capabilities:m.capabilities,details:{family:m.family??"",parameter_size:m.parameter_size},model_info:m.context?{"general.architecture":"x","x.context_length":m.context}:{}});
      }
      if(req.url==="/api/chat"){
        if(body.tools&&toolRejecting.has(body.model))return send(400,{error:`registry.ollama.ai/library/${body.model} does not support tools`});
        const next=replies.get(body.model)?.shift();
        if(next==="404")return send(404,{error:`model "${body.model}" not found, try pulling it first`});
        const message=typeof next==="string"?{role:"assistant",content:next}:{role:"assistant",content:"",...(next??{content:"ok from "+body.model})};
        return send(200,{model:body.model,message,done:true});
      }
      if(req.url==="/api/embed")return send(200,{model:body.model,embeddings:(body.input as string[]).map(()=>[0.1,0.2,0.3])});
      send(404,{error:"unknown endpoint"});
    });
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
  const port=(server.address() as {port:number}).port;
  return{
    url:`http://127.0.0.1:${port}`,calls,replies,
    close:()=>new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();})
  };
}
