import {createServer} from "node:http";

export interface HealthServerOptions{
  port?:number;
  host?:string;
  readiness?:()=>boolean|Promise<boolean>;
}

export function startHealthServer(options:HealthServerOptions={}){
  const port=options.port??Number(process.env.PORT??3000);
  const host=options.host??"0.0.0.0";
  const readiness=options.readiness??(()=>true);
  const server=createServer(async(request,response)=>{
    if(request.method!=="GET"||request.url!=="/health"){
      response.statusCode=404;
      response.setHeader("content-type","application/json");
      response.end(JSON.stringify({ok:false,error:"not_found"}));
      return;
    }
    try{
      const ready=await readiness();
      response.statusCode=ready?200:503;
      response.setHeader("content-type","application/json");
      response.end(JSON.stringify({ok:ready,status:ready?"healthy":"unhealthy"}));
    }catch{
      response.statusCode=503;
      response.setHeader("content-type","application/json");
      response.end(JSON.stringify({ok:false,status:"unhealthy"}));
    }
  });
  server.listen(port,host);
  return server;
}
