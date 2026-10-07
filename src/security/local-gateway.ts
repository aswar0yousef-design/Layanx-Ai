import http from "node:http";
import net from "node:net";
import os from "node:os";
import type {AccessManager,PublicDevice} from "./access.js";
import {isTailscaleAddress} from "../platform/tailscale.js";

/**
 * The gateway is the ONLY listener reachable from the browser or the LAN.
 * The existing LayanX API keeps running unchanged on a random loopback port
 * and only ever receives requests that already passed these checks:
 *
 *  1. Host header must be a loopback name (or one of this PC's LAN addresses
 *     when phone access is on)            -> blocks DNS-rebinding.
 *  2. Browser requests authenticate with an HttpOnly SameSite=Strict cookie
 *     that only works from this computer, and unsafe methods must come from
 *     a trusted LayanX origin            -> blocks CSRF from any website.
 *  3. Phones authenticate with a per-device bearer token from pairing.
 *  4. The internal API token is injected here; clients never see it.
 */
export interface GatewayListener{name:string;publicPort:number;internalPort:number}

export type Principal=
  |{kind:"owner";via:"session"|"master"}
  |{kind:"device";device:PublicDevice}
  |{kind:"public";route:string};

/**
 * Requests that cannot carry a LayanX session but must still reach the runtime:
 *  - OAuth providers redirect the browser back here (cross-site navigation, so the
 *    SameSite=Strict cookie is not sent); the runtime validates the OAuth state.
 *  - WhatsApp webhooks arrive through a local tunnel (cloudflared/ngrok -> 127.0.0.1).
 * Both are accepted from loopback only.
 */
const PUBLIC_LOOPBACK_ROUTES:Array<{method:string[];path:RegExp;name:string}>=[
  {method:["GET"],path:/^\/v1\/oauth\/callback(\/|$)/,name:"oauth-callback"},
  {method:["GET","POST"],path:/^\/v1\/channels\/whatsapp\/webhook$/,name:"whatsapp-webhook"}
];

export interface RouteContext{
  req:http.IncomingMessage;
  res:http.ServerResponse;
  url:URL;
  method:string;
  principal:Principal|null;
  loopback:boolean;
  remoteAddress:string;
  listener:GatewayListener;
  readJson():Promise<unknown>;
  sendJson(status:number,body:unknown,headers?:http.OutgoingHttpHeaders):void;
}

export interface GatewayOptions{
  bindHost:string;
  listeners:GatewayListener[];
  access:AccessManager;
  internalToken:string;
  /** Header the legacy API reads its token from. "authorization" sends "Bearer <token>". */
  authHeader?:string;
  mobileAccess:boolean;
  /** Phones from anywhere: Tailscale (by IP or via `tailscale serve`) or a tunnel hostname. */
  remoteAccess?:boolean;
  /** Public hostnames of a tunnel that forwards to this PC (requests arrive from 127.0.0.1). */
  remoteHosts?:string[];
  sessionCookie?:string;
  handleOwnRoute:(ctx:RouteContext)=>Promise<boolean>;
  log:(level:"info"|"warn"|"error",message:string)=>void;
  /** test hooks */
  isLoopback?:(address:string|undefined)=>boolean;
  localAddresses?:()=>string[];
}

const HOP_BY_HOP=new Set(["connection","keep-alive","proxy-authenticate","proxy-authorization","proxy-connection","te","trailer","transfer-encoding","upgrade"]);
const LOOPBACK_HOSTS=new Set(["127.0.0.1","localhost","[::1]","::1"]);
const UNSAFE_METHODS=new Set(["POST","PUT","PATCH","DELETE"]);
const MAX_JSON_BYTES=64*1024;

export function isLoopbackAddress(address:string|undefined):boolean{
  if(!address)return false;
  return address==="::1"||address.startsWith("127.")||address.startsWith("::ffff:127.");
}

export function localInterfaceAddresses():string[]{
  const out:string[]=[];
  for(const list of Object.values(os.networkInterfaces()))
    for(const item of list??[])if(!item.internal&&item.family==="IPv4")out.push(item.address);
  return out;
}

export function lanUrls(port:number,addresses:string[]=localInterfaceAddresses()):string[]{
  return addresses.map(address=>`http://${address}:${port}`);
}

function parseHost(value:string|undefined):{hostname:string;port:number|null}|null{
  if(!value||value.length>255)return null;
  const match=/^(\[[0-9a-fA-F:.]+\]|[^:]+)(?::(\d{1,5}))?$/.exec(value.trim());
  if(!match||!match[1])return null;
  return{hostname:match[1].toLowerCase(),port:match[2]?Number(match[2]):null};
}

function readCookie(header:string|undefined,name:string):string|null{
  if(!header)return null;
  for(const part of header.split(";")){
    const [k,...rest]=part.trim().split("=");
    if(k===name)return decodeURIComponent(rest.join("="));
  }
  return null;
}

function stripCookie(header:string|undefined,name:string):string|undefined{
  if(!header)return undefined;
  const kept=header.split(";").map(p=>p.trim()).filter(p=>p&&!p.startsWith(name+"="));
  return kept.length?kept.join("; "):undefined;
}

function bearerToken(req:http.IncomingMessage):string|null{
  const auth=req.headers.authorization;
  if(typeof auth==="string"&&/^Bearer\s+/i.test(auth))return auth.replace(/^Bearer\s+/i,"").trim()||null;
  return null;
}

function wantsHtml(req:http.IncomingMessage):boolean{
  return req.method==="GET"&&String(req.headers.accept??"").includes("text/html");
}

const PAGE_STYLE="font-family:'Segoe UI',Tahoma,sans-serif;max-width:34rem;margin:15vh auto;padding:0 1.5rem;line-height:1.7;color:#18232D";
function htmlNotice(title:string,body:string,refreshSeconds?:number):string{
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refreshSeconds?`<meta http-equiv="refresh" content="${refreshSeconds}">`:""}<title>${title}</title></head><body style="${PAGE_STYLE}"><h1 style="font-size:1.5rem">${title}</h1><p>${body}</p></body></html>`;
}

export interface GatewayHandle{
  servers:http.Server[];
  close():Promise<void>;
}

export async function startGateway(options:GatewayOptions):Promise<GatewayHandle>{
  const cookieName=options.sessionCookie??"layanx_session";
  const authHeader=(options.authHeader??"authorization").toLowerCase();
  const isLoopback=options.isLoopback??isLoopbackAddress;
  const addresses=options.localAddresses??localInterfaceAddresses;
  const agent=new http.Agent({keepAlive:true,maxSockets:64});

  const trustedOrigins=new Set<string>();
  for(const l of options.listeners)
    for(const h of ["127.0.0.1","localhost","[::1]"])trustedOrigins.add(`http://${h}:${l.publicPort}`);

  /**
   * Who is really on the other side? A tunnel or `tailscale serve` connects from 127.0.0.1,
   * so a remote hostname (*.ts.net or a configured tunnel host) makes the request REMOTE:
   * no browser sessions, no master token, no setup pages; paired devices only.
   */
  function admit(req:http.IncomingMessage):{ok:true;loopback:boolean;hostname:string}|{ok:false;status:number;error:string;message:string}{
    const remoteAddress=req.socket.remoteAddress??"";
    const socketLoopback=isLoopback(remoteAddress);
    const host=parseHost(req.headers.host);
    if(!host)return{ok:false,status:421,error:"host_not_allowed",message:"Unexpected Host header."};
    const proxiedRemote=host.hostname.endsWith(".ts.net")||(options.remoteHosts??[]).includes(host.hostname);
    if(proxiedRemote){
      if(!options.remoteAccess)return{ok:false,status:403,error:"remote_disabled",message:"Control from anywhere is turned off on this computer."};
      return{ok:true,loopback:false,hostname:host.hostname};
    }
    if(!socketLoopback){
      const tailnet=isTailscaleAddress(remoteAddress);
      if(tailnet?!(options.remoteAccess||options.mobileAccess):!options.mobileAccess)
        return{ok:false,status:403,error:"lan_disabled",message:tailnet?"Control from anywhere is turned off on this computer.":"Phone access is turned off on this computer."};
    }
    if(!hostAllowed(host.hostname,socketLoopback))return{ok:false,status:421,error:"host_not_allowed",message:"Unexpected Host header."};
    return{ok:true,loopback:socketLoopback,hostname:host.hostname};
  }

  function hostAllowed(hostname:string,loopback:boolean):boolean{
    if(loopback)return LOOPBACK_HOSTS.has(hostname);
    const machine=os.hostname().toLowerCase();
    return addresses().includes(hostname)||hostname===machine||hostname===machine+".local";
  }

  function sendJson(res:http.ServerResponse,status:number,body:unknown,headers:http.OutgoingHttpHeaders={}){
    if(res.headersSent){res.end();return;}
    res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...headers});
    res.end(JSON.stringify(body));
  }

  function readJson(req:http.IncomingMessage):Promise<unknown>{
    return new Promise((resolve,reject)=>{
      const type=String(req.headers["content-type"]??"").split(";")[0]?.trim().toLowerCase();
      if(type!=="application/json"){reject(Object.assign(new Error("Content-Type must be application/json."),{status:415}));return;}
      let size=0;const chunks:Buffer[]=[];
      req.on("data",(chunk:Buffer)=>{
        size+=chunk.length;
        if(size>MAX_JSON_BYTES){reject(Object.assign(new Error("Request body too large."),{status:413}));req.destroy();return;}
        chunks.push(chunk);
      });
      req.on("end",()=>{
        const text=Buffer.concat(chunks).toString("utf8");
        if(!text.trim()){resolve({});return;}
        try{resolve(JSON.parse(text));}catch{reject(Object.assign(new Error("Invalid JSON body."),{status:400}));}
      });
      req.on("error",reject);
    });
  }

  function authenticate(req:http.IncomingMessage,loopback:boolean,origin:string|undefined,allowQueryToken:URL|null):{principal:Principal|null;error?:string}{
    let token=bearerToken(req);
    if(!token&&allowQueryToken){token=allowQueryToken.searchParams.get("layanx_token");}
    if(token){
      const device=options.access.verifyDeviceToken(token);
      if(device)return{principal:{kind:"device",device}};
      if(loopback&&options.access.isMasterToken(token))return{principal:{kind:"owner",via:"master"}};
      // An old token saved by a page (localStorage) must not lock out a valid local session.
      if(!loopback||!options.access.verifySession(readCookie(req.headers.cookie,cookieName)??""))
        return{principal:null,error:"Invalid or revoked token."};
    }
    if(!loopback)return{principal:null};
    const session=readCookie(req.headers.cookie,cookieName);
    if(!session||!options.access.verifySession(session))return{principal:null};
    if(origin&&!trustedOrigins.has(origin))return{principal:null,error:"Cross-site request blocked."};
    const site=req.headers["sec-fetch-site"];
    if(typeof site==="string"&&!["same-origin","same-site","none"].includes(site))return{principal:null,error:"Cross-site request blocked."};
    if(UNSAFE_METHODS.has(req.method??"GET")&&!(origin&&trustedOrigins.has(origin)))
      return{principal:null,error:"Unsafe request without a trusted Origin header."};
    return{principal:{kind:"owner",via:"session"}};
  }

  function upstreamHeaders(req:http.IncomingMessage,listener:GatewayListener,principal:Principal,keepUpgrade:boolean):http.OutgoingHttpHeaders{
    const connectionTokens=new Set(String(req.headers.connection??"").toLowerCase().split(",").map(s=>s.trim()).filter(Boolean));
    const out:http.OutgoingHttpHeaders={};
    for(const [name,value] of Object.entries(req.headers)){
      if(value===undefined)continue;
      const key=name.toLowerCase();
      const hop=HOP_BY_HOP.has(key)||connectionTokens.has(key);
      if(hop&&!(keepUpgrade&&(key==="upgrade"||key==="connection")))continue;
      if(["host","authorization","cookie","origin","referer","x-forwarded-for","x-forwarded-host","x-forwarded-proto",authHeader].includes(key))continue;
      // Only the gateway's own identity headers are reserved; app headers such as x-layanx-language pass through.
      if(key==="x-layanx-principal"||key==="x-layanx-api-token")continue;
      out[key]=value;
    }
    const cookie=stripCookie(req.headers.cookie,cookieName);
    if(cookie)out.cookie=cookie;
    out.host=`127.0.0.1:${listener.internalPort}`;
    if(authHeader==="authorization")out.authorization=`Bearer ${options.internalToken}`;
    else out[authHeader]=options.internalToken;
    out["x-layanx-api-token"]=options.internalToken;
    out["x-layanx-principal"]=principal.kind==="device"?`device:${principal.device.id}`:principal.kind==="public"?`public:${principal.route}`:"owner";
    out["x-forwarded-for"]=req.socket.remoteAddress??"";
    out["x-forwarded-proto"]="http";
    return out;
  }

  function proxy(req:http.IncomingMessage,res:http.ServerResponse,listener:GatewayListener,principal:Principal,corsHeaders:http.OutgoingHttpHeaders){
    const upstream=http.request({
      host:"127.0.0.1",port:listener.internalPort,method:req.method,path:req.url,agent,
      headers:upstreamHeaders(req,listener,principal,false)
    },up=>{
      const headers:http.OutgoingHttpHeaders={};
      for(const [name,value] of Object.entries(up.headers)){
        if(value===undefined||HOP_BY_HOP.has(name.toLowerCase()))continue;
        headers[name]=value;
      }
      res.writeHead(up.statusCode??502,{...headers,...corsHeaders});
      up.pipe(res);
    });
    upstream.on("error",error=>{
      const starting=(error as NodeJS.ErrnoException).code==="ECONNREFUSED";
      if(res.headersSent){res.destroy();return;}
      if(starting&&wantsHtml(req)){
        res.writeHead(503,{"content-type":"text/html; charset=utf-8","retry-after":"2"});
        res.end(htmlNotice("LayanX يبدأ التشغيل","ستُحدَّث الصفحة تلقائياً خلال ثوانٍ.",2));
        return;
      }
      sendJson(res,starting?503:502,{error:starting?"runtime_starting":"runtime_unreachable",message:starting?"The LayanX runtime is still starting.":error.message},corsHeaders);
    });
    res.on("close",()=>{if(!res.writableFinished)upstream.destroy();});
    req.pipe(upstream);
  }

  async function handle(listener:GatewayListener,req:http.IncomingMessage,res:http.ServerResponse){
    const remoteAddress=req.socket.remoteAddress??"";
    const admission=admit(req);
    if(!admission.ok){sendJson(res,admission.status,{error:admission.error,message:admission.message});return;}
    const loopback=admission.loopback;
    const url=new URL(req.url??"/","http://gateway.local");
    const origin=typeof req.headers.origin==="string"?req.headers.origin:undefined;
    const trusted=!!origin&&trustedOrigins.has(origin);
    const method=(req.method??"GET").toUpperCase();

    if(method==="OPTIONS"){
      const requested=String(req.headers["access-control-request-headers"]??"").toLowerCase();
      const base={"access-control-allow-methods":"GET,POST,PUT,PATCH,DELETE,OPTIONS","access-control-allow-headers":requested||"content-type","access-control-max-age":"600",vary:"Origin"};
      if(origin&&trusted){res.writeHead(204,{...base,"access-control-allow-origin":origin,"access-control-allow-credentials":"true"});res.end();return;}
      if(origin&&requested.includes("authorization")){res.writeHead(204,{...base,"access-control-allow-origin":origin});res.end();return;}
      sendJson(res,403,{error:"cors_blocked"});return;
    }

    const {principal,error}=authenticate(req,loopback,origin,null);
    const cors:http.OutgoingHttpHeaders={};
    if(origin&&trusted){cors["access-control-allow-origin"]=origin;cors["access-control-allow-credentials"]="true";cors.vary="Origin";}
    else if(origin&&principal?.kind==="device"){cors["access-control-allow-origin"]=origin;cors.vary="Origin";}

    const ctx:RouteContext={
      req,res,url,method,principal,loopback,remoteAddress,listener,
      readJson:()=>readJson(req),
      sendJson:(status,body,headers={})=>sendJson(res,status,body,{...cors,...headers})
    };
    try{
      if(await options.handleOwnRoute(ctx))return;
    }catch(err){
      const status=(err as {status?:number}).status??500;
      if(status>=500)options.log("error",`gateway route ${method} ${url.pathname}: ${(err as Error).stack??err}`);
      ctx.sendJson(status,{error:"request_failed",message:status>=500?"Internal error. See the LayanX log.":(err as Error).message});
      return;
    }
    if(!principal&&loopback){
      const route=PUBLIC_LOOPBACK_ROUTES.find(r=>r.method.includes(method)&&r.path.test(url.pathname));
      if(route){proxy(req,res,listener,{kind:"public",route:route.name},cors);return;}
    }
    if(!principal){
      if(!error&&wantsHtml(req)){
        res.writeHead(401,{"content-type":"text/html; charset=utf-8","cache-control":"no-store"});
        res.end(htmlNotice("افتح LayanX من الاختصار","لحماية أسرارك، لا تعمل هذه الواجهة إلا عند فتحها من اختصار LayanX على سطح المكتب. انقر عليه نقراً مزدوجاً وسيفتح المتصفح هنا تلقائياً."));
        return;
      }
      ctx.sendJson(error?403:401,{error:error?"forbidden":"unauthorized",message:error??"Authentication required."});
      return;
    }
    proxy(req,res,listener,principal,cors);
  }

  function handleUpgrade(listener:GatewayListener,req:http.IncomingMessage,socket:net.Socket,head:Buffer){
    const reject=(status:string)=>{socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);};
    const admission=admit(req);
    if(!admission.ok)return reject(admission.status===421?"421 Misdirected Request":"403 Forbidden");
    const loopback=admission.loopback;
    const url=new URL(req.url??"/","http://gateway.local");
    const origin=typeof req.headers.origin==="string"?req.headers.origin:undefined;
    const {principal}=authenticate(req,loopback,origin,url);
    if(!principal)return reject("401 Unauthorized");
    url.searchParams.delete("layanx_token");
    const path=url.pathname+(url.search||"");
    const upstream=net.connect(listener.internalPort,"127.0.0.1",()=>{
      const headers=upstreamHeaders(req,listener,principal,true);
      const lines=[`${req.method} ${path} HTTP/1.1`];
      for(const [k,v] of Object.entries(headers)){
        if(v===undefined)continue;
        for(const item of Array.isArray(v)?v:[String(v)])lines.push(`${k}: ${item}`);
      }
      upstream.write(lines.join("\r\n")+"\r\n\r\n");
      if(head.length)upstream.write(head);
      upstream.pipe(socket);socket.pipe(upstream);
    });
    upstream.on("error",()=>socket.destroy());
    socket.on("error",()=>upstream.destroy());
  }

  const servers:http.Server[]=[];
  const tunnels=new Set<net.Socket>();
  for(const listener of options.listeners){
    const server=http.createServer((req,res)=>{void handle(listener,req,res);});
    server.on("upgrade",(req,socket,head)=>{
      const s=socket as net.Socket;
      tunnels.add(s);s.once("close",()=>tunnels.delete(s));
      handleUpgrade(listener,req,s,head);
    });
    server.headersTimeout=30_000;
    await listenWithRetry(server,listener.publicPort,options.bindHost);
    servers.push(server);
    options.log("info",`gateway ${listener.name} listening on ${options.bindHost}:${listener.publicPort} -> 127.0.0.1:${listener.internalPort}`);
  }
  return{
    servers,
    close:async()=>{
      agent.destroy();
      for(const socket of tunnels)socket.destroy();
      // Upgraded (WebSocket) connections can keep server.close() waiting; never block shutdown on them.
      await Promise.race([
        Promise.all(servers.map(s=>new Promise<void>(resolve=>{s.close(()=>resolve());s.closeAllConnections?.();}))),
        new Promise<void>(resolve=>setTimeout(resolve,1500).unref())
      ]);
    }
  };
}

/** Retries EADDRINUSE for a few seconds so an in-place restart can reuse the port. */
export function listenWithRetry(server:http.Server,port:number,host:string,attempts=20,delayMs=500):Promise<void>{
  return new Promise((resolve,reject)=>{
    let tries=0;
    const attempt=()=>{
      const onError=(error:NodeJS.ErrnoException)=>{
        server.off("listening",onListening);
        if(error.code==="EADDRINUSE"&&++tries<attempts){setTimeout(attempt,delayMs);return;}
        reject(error.code==="EADDRINUSE"?new Error(`Port ${port} is already used by another program. Close it or set LAYANX_PUBLIC_PORT.`):error);
      };
      const onListening=()=>{server.off("error",onError);resolve();};
      server.once("error",onError);
      server.once("listening",onListening);
      server.listen(port,host);
    };
    attempt();
  });
}

export async function freeLoopbackPort():Promise<number>{
  return new Promise((resolve,reject)=>{
    const srv=net.createServer();
    srv.once("error",reject);
    srv.listen(0,"127.0.0.1",()=>{
      const address=srv.address();
      const port=typeof address==="object"&&address?address.port:0;
      srv.close(()=>port?resolve(port):reject(new Error("Could not allocate a loopback port.")));
    });
  });
}
