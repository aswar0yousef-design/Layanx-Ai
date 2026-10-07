import http from "node:http";

/**
 * Stand-in for the real src/api.ts in end-to-end tests. Like the real runtime
 * it reads LAYANX_API_HOST/PORT and LAYANX_FLOW_HOST/PORT and rejects requests
 * without LAYANX_API_TOKEN when a token is configured.
 */
function serve(port:number,name:string){
  const server=http.createServer((req,res)=>{
    const token=process.env.LAYANX_API_TOKEN;
    if(token&&req.headers.authorization!==`Bearer ${token}`){res.writeHead(401,{"content-type":"application/json"});res.end('{"error":"no token"}');return;}
    let body="";
    req.setEncoding("utf8");
    req.on("data",c=>{body+=c;});
    req.on("end",()=>{
      res.writeHead(200,{"content-type":"application/json"});
      res.end(JSON.stringify({
        name,path:req.url,method:req.method,body,
        headers:{
          authorization:req.headers.authorization?"present":null,
          cookie:req.headers.cookie??null,
          origin:req.headers.origin??null,
          principal:req.headers["x-layanx-principal"]??null
        },
        env:{
          TEST_SECRET:process.env.TEST_SECRET?"loaded":null,
          OLLAMA_MODEL:process.env.OLLAMA_MODEL??null,
          OLLAMA_VISION_MODEL:process.env.OLLAMA_VISION_MODEL??null,
          BUSINESS:process.env.LAYANX_BUSINESS_STORAGE_PATH??null,
          LAYANX_CAPABILITIES:process.env.LAYANX_CAPABILITIES??null
        }
      }));
    });
  });
  server.on("upgrade",(req,socket)=>{
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Principal: "+String(req.headers["x-layanx-principal"])+"\r\n\r\n");
    socket.on("data",d=>socket.write(d));
  });
  server.listen(port,process.env.LAYANX_API_HOST??"127.0.0.1");
}
serve(Number(process.env.LAYANX_API_PORT),"api");
serve(Number(process.env.LAYANX_FLOW_PORT),"flow");
