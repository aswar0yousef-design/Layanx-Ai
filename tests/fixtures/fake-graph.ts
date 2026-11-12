import http from "node:http";

/**
 * A stand-in for a Facebook Page's Graph API where LayanX depends on it: POST /{page}/feed with a form body (message,
 * access_token) creates a post; GET /{post}?fields=message,permalink_url with "Authorization: Bearer" reads it back.
 * A token in the address is refused, as a reminder that it must never be sent there. `changeText` simulates a platform
 * that stores something else than what was sent.
 */
export interface FakeGraph{url:string;posts:Array<{id:string;page:string;message:string}>;requests:Array<{method:string;path:string;body?:string}>;close():Promise<void>}
export async function startFakeGraph(opts:{token?:string;changeText?:(t:string)=>string}={}):Promise<FakeGraph>{
  const token=opts.token??"page_token_test";
  const posts:FakeGraph["posts"]=[],requests:FakeGraph["requests"]=[];
  const server=http.createServer(async(req,res)=>{
    let body="";for await(const c of req)body+=c;
    const u=new URL(req.url??"/","http://x");
    requests.push({method:req.method??"GET",path:u.pathname+u.search,...(body?{body}:{})});
    const send=(s:number,d:unknown)=>{res.writeHead(s,{"content-type":"application/json"});res.end(JSON.stringify(d));};
    if(u.searchParams.has("access_token"))return send(400,{error:{message:"access token in the URL",code:100}});
    const parts=u.pathname.split("/").filter(Boolean);
    if(req.method==="POST"&&parts.length===2&&parts[1]==="feed"){
      const f=new URLSearchParams(body);
      if(f.get("access_token")!==token)return send(401,{error:{message:"Invalid OAuth access token.",code:190}});
      const message=f.get("message")??"";
      const id=`${parts[0]}_${100+posts.length}`;
      posts.push({id,page:parts[0]!,message:opts.changeText?opts.changeText(message):message});
      return send(200,{id});
    }
    if(req.method==="GET"&&parts.length===1){
      if(req.headers.authorization!=="Bearer "+token)return send(401,{error:{message:"Invalid OAuth access token.",code:190}});
      const p=posts.find(x=>x.id===parts[0]);
      if(!p)return send(404,{error:{message:"Unsupported get request.",code:100}});
      return send(200,{id:p.id,message:p.message,permalink_url:`https://www.facebook.com/${p.id}`});
    }
    send(404,{error:{message:"Unknown path",code:803}});
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
  return{url:"http://127.0.0.1:"+(server.address() as {port:number}).port,posts,requests,close:()=>new Promise(r=>server.close(()=>r()))};
}
