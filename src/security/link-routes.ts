import type {AccessManager} from "./access.js";
import {forwardInternal,type RouteContext} from "./local-gateway.js";
import {LinkIdentity,PAIR_AAD,PAIR_OK_AAD,ReplayGuard,b64u,isPublicPoint,open,pairKey,parseInner,requestAad,responseAad,seal,sessionKeys} from "./phone-link.js";

export interface LinkRouteDeps{
  access:AccessManager;
  identity:LinkIdentity;
  installId:string;
  computer:string;
  addresses():Promise<string[]>;
  internalToken:string;
  authHeader?:string;
  replay?:ReplayGuard;
}

/** Voice clips travel base64-encoded inside the encrypted envelope. */
const MAX_LINK_BODY=8*1024*1024;
const TEXT=/^(application\/json|text\/)/i;

/**
 * /v1/link/pair and /v1/link: the encrypted phone link (see phone-link.ts). They answer before any
 * bearer or cookie check, because the envelope itself is the authentication; the gateway's network
 * checks (phone access on, Host header) still apply.
 */
export function createLinkRoutes(deps:LinkRouteDeps){
  const replay=deps.replay??new ReplayGuard();
  const keys=new Map<string,{linkKey:string;c2s:Buffer;s2c:Buffer}>();
  const keysFor=(deviceId:string,linkKey:string)=>{
    const cached=keys.get(deviceId);
    if(cached&&cached.linkKey===linkKey)return cached;
    const k={linkKey,...sessionKeys(deps.identity.shared(b64u.dec(linkKey)),deviceId)};
    keys.set(deviceId,k);
    return k;
  };
  return async(ctx:RouteContext):Promise<boolean>=>{
    const path=ctx.url.pathname.replace(/\/+$/,"");
    if(path==="/v1/link/pair"&&ctx.method==="POST"){
      const body=await ctx.readJson() as {v?:unknown;pk?:unknown;n?:unknown;c?:unknown};
      let phoneKey:Buffer,key:Buffer,inner:{code?:unknown;name?:unknown};
      try{
        phoneKey=b64u.dec(String(body.pk??""));
        if(body.v!==2||!isPublicPoint(phoneKey))throw new Error("bad");
        key=pairKey(deps.identity.shared(phoneKey),phoneKey,deps.identity.publicKey);
        inner=JSON.parse(open(key,body,PAIR_AAD).toString("utf8")) as {code?:unknown;name?:unknown};
      }catch{ctx.sendJson(400,{error:"bad_envelope",message:"This pairing request cannot be read. Scan the code on this computer again."});return true;}
      const result=deps.access.completePairingV2(inner.code,inner.name,b64u.enc(phoneKey),ctx.remoteAddress);
      if(!result.ok){ctx.sendJson(result.status,{error:"pairing_failed",message:result.error});return true;}
      const reply=seal(key,JSON.stringify({deviceId:result.deviceId,installId:deps.installId,computer:deps.computer,addresses:await deps.addresses()}),PAIR_OK_AAD);
      ctx.sendJson(200,reply);
      return true;
    }
    if(path==="/v1/link"&&ctx.method==="POST"){
      const body=await ctx.readJson(MAX_LINK_BODY) as {v?:unknown;d?:unknown;n?:unknown;c?:unknown};
      const deviceId=String(body.d??"");
      const known=/^dev_[a-f0-9]{12}$/.test(deviceId)?deps.access.linkDevice(deviceId):null;
      if(!known){ctx.sendJson(401,{error:"unknown_device",message:"This phone is not paired with this computer (or was removed). Pair it again."});return true;}
      let k:{c2s:Buffer;s2c:Buffer},inner:ReturnType<typeof parseInner>;
      try{
        k=keysFor(deviceId,known.linkKey);
        inner=parseInner(open(k.c2s,body,requestAad(deviceId)));
      }catch{ctx.sendJson(400,{error:"bad_envelope"});return true;}
      if(!replay.accept(deviceId,inner.r,inner.t)){ctx.sendJson(409,{error:"stale_request",message:"The request was replayed or the phone's clock is more than 5 minutes off."});return true;}
      let answer:{s:number;ct:string;b:string;b64?:boolean};
      if(inner.p.split("?")[0]==="/v1/device/whoami"){
        answer={s:200,ct:"application/json",b:JSON.stringify({deviceId,name:known.device.name,installId:deps.installId,computer:deps.computer,addresses:await deps.addresses()})};
      }else{
        try{
          const payload=inner.b===undefined?undefined:inner.b64?Buffer.from(inner.b,"base64"):Buffer.from(inner.b,"utf8");
          const r=await forwardInternal({port:ctx.listener.internalPort,internalToken:deps.internalToken,...(deps.authHeader?{authHeader:deps.authHeader}:{}),principal:`device:${deviceId}`,
            method:inner.m,path:inner.p,...(payload?{body:payload,contentType:inner.bt}:{}),timeoutMs:180_000});
          answer=TEXT.test(r.contentType)?{s:r.status,ct:r.contentType,b:r.body.toString("utf8")}:{s:r.status,ct:r.contentType,b:r.body.toString("base64"),b64:true};
        }catch(error){
          const starting=(error as NodeJS.ErrnoException).code==="ECONNREFUSED";
          answer={s:starting?503:502,ct:"application/json",b:JSON.stringify({error:starting?"runtime_starting":"runtime_unreachable",message:starting?"The LayanX runtime is still starting.":(error as Error).message})};
        }
      }
      ctx.sendJson(200,seal(k.s2c,JSON.stringify(answer),responseAad(deviceId,inner.r)));
      return true;
    }
    return false;
  };
}
