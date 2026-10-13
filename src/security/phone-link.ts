import crypto from "node:crypto";

/**
 * The phone link, version 2: every request between the LayanX phone app and this PC is end-to-end
 * encrypted and authenticated, whatever carries it (home Wi-Fi over plain HTTP, Tailscale, a tunnel).
 *
 *  - This PC has a P-256 key pair (private key in the DPAPI secret store). Its public key travels only
 *    in the pairing QR code, so the phone knows it is talking to THIS computer (no certificate to trust).
 *  - At pairing the phone makes its own key pair and sends its public key with the pairing code,
 *    encrypted to the PC's key: someone on the same Wi-Fi sees neither the code nor anything after it.
 *  - Then: ECDH shared secret -> HKDF-SHA256 -> one AES-256-GCM key per direction. Every request has a
 *    fresh nonce, a timestamp (±5 min) and a random id that is accepted once (no replay); every answer
 *    is bound to the request id it answers.
 *
 * The phone side is the same protocol in Java (mobile/modules/layanx-native/.../LinkCrypto.java);
 * tests/phone-link.spec.ts runs both against each other.
 */
export const LINK_VERSION=2;
const CURVE="prime256v1";
export const PAIR_AAD="layanx/v2/pair",PAIR_OK_AAD="layanx/v2/pair-ok";
export const requestAad=(deviceId:string)=>`layanx/v2/req|${deviceId}`;
export const responseAad=(deviceId:string,requestId:string)=>`layanx/v2/res|${deviceId}|${requestId}`;
export const MAX_SKEW_MS=5*60_000;

export const b64u={enc:(b:Uint8Array)=>Buffer.from(b).toString("base64url"),dec:(s:string)=>Buffer.from(String(s??""),"base64url")};

export function isPublicPoint(key:Buffer):boolean{return key.length===65&&key[0]===4;}

export class LinkIdentity{
  private readonly ecdh:crypto.ECDH;
  readonly publicKey:Buffer;
  /** privateKey: 32 random bytes (base64url), as kept in the secret store. */
  constructor(privateKey:string){
    this.ecdh=crypto.createECDH(CURVE);
    this.ecdh.setPrivateKey(b64u.dec(privateKey));
    this.publicKey=this.ecdh.getPublicKey();
  }
  /** ECDH with a phone's public key (65-byte uncompressed point); throws for anything not on the curve. */
  shared(peer:Buffer):Buffer{
    if(!isPublicPoint(peer))throw new Error("bad public key");
    return this.ecdh.computeSecret(peer);
  }
}

export function hkdf(ikm:Buffer,salt:string,info:Buffer|string,length=32):Buffer{
  return Buffer.from(crypto.hkdfSync("sha256",ikm,Buffer.from(salt,"utf8"),typeof info==="string"?Buffer.from(info,"utf8"):info,length));
}
export const pairKey=(shared:Buffer,phoneKey:Buffer,pcKey:Buffer)=>hkdf(shared,"layanx-link/v2/pair",Buffer.concat([phoneKey,pcKey]));
export const sessionKeys=(shared:Buffer,deviceId:string)=>({c2s:hkdf(shared,"layanx-link/v2","c2s:"+deviceId),s2c:hkdf(shared,"layanx-link/v2","s2c:"+deviceId)});

export interface Sealed{n:string;c:string}
/** AES-256-GCM: 12-byte random nonce; c = ciphertext followed by the 16-byte tag (as Java's GCM writes it). */
export function seal(key:Buffer,plaintext:Buffer|string,aad:string):Sealed{
  const nonce=crypto.randomBytes(12);
  const cipher=crypto.createCipheriv("aes-256-gcm",key,nonce);
  cipher.setAAD(Buffer.from(aad,"utf8"));
  const body=Buffer.concat([cipher.update(typeof plaintext==="string"?Buffer.from(plaintext,"utf8"):plaintext),cipher.final(),cipher.getAuthTag()]);
  return{n:b64u.enc(nonce),c:b64u.enc(body)};
}
export function open(key:Buffer,sealed:{n?:unknown;c?:unknown},aad:string):Buffer{
  const nonce=b64u.dec(String(sealed.n??"")),body=b64u.dec(String(sealed.c??""));
  if(nonce.length!==12||body.length<16)throw new Error("bad envelope");
  const decipher=crypto.createDecipheriv("aes-256-gcm",key,nonce);
  decipher.setAAD(Buffer.from(aad,"utf8"));
  decipher.setAuthTag(body.subarray(body.length-16));
  return Buffer.concat([decipher.update(body.subarray(0,body.length-16)),decipher.final()]);
}

/** The pairing link inside the QR code (printable ASCII only). */
export function pairingUri(input:{publicKey:Buffer;code:string;computer:string;urls:string[]}):string{
  const q=[`v=${LINK_VERSION}`,`k=${b64u.enc(input.publicKey)}`,`c=${encodeURIComponent(input.code)}`,`n=${encodeURIComponent(input.computer.slice(0,40))}`,`u=${input.urls.slice(0,6).map(encodeURIComponent).join(",")}`];
  return "layanx://pair?"+q.join("&");
}

/** Requests accepted once each, per device, inside the time window. */
export class ReplayGuard{
  private readonly seen=new Map<string,Map<string,number>>();
  constructor(private readonly now:()=>number=Date.now){}
  /** False when the timestamp is outside the window or the id was already used. */
  accept(deviceId:string,requestId:string,timestamp:number):boolean{
    const now=this.now();
    if(!Number.isFinite(timestamp)||Math.abs(now-timestamp)>MAX_SKEW_MS)return false;
    if(!/^[A-Za-z0-9_-]{16,64}$/.test(requestId))return false;
    let ids=this.seen.get(deviceId);
    if(!ids){ids=new Map();this.seen.set(deviceId,ids);}
    if(ids.size>4000)for(const [id,exp] of ids)if(exp<now)ids.delete(id);
    if(ids.has(requestId))return false;
    if(ids.size>8000)return false;
    ids.set(requestId,now+2*MAX_SKEW_MS);
    return true;
  }
}

export interface InnerRequest{m:string;p:string;b?:string;bt?:string;b64?:boolean;t:number;r:string}
export interface InnerResponse{s:number;ct:string;b:string;b64?:boolean}
const METHODS=new Set(["GET","POST","PUT","PATCH","DELETE"]);
const BODY_TYPES=new Set(["application/json","audio/wav","audio/webm","audio/mp4","audio/mpeg","audio/ogg"]);
export function parseInner(raw:Buffer):InnerRequest{
  const v=JSON.parse(raw.toString("utf8")) as Partial<InnerRequest>;
  const m=String(v.m??"").toUpperCase();
  const p=String(v.p??"");
  if(!METHODS.has(m))throw new Error("bad method");
  if(!/^\/v1\/[A-Za-z0-9/_.~%-]*(\?[A-Za-z0-9/_.~%=&+-]*)?$/.test(p)||p.includes(".."))throw new Error("bad path");
  const bt=v.bt===undefined?"application/json":String(v.bt).toLowerCase();
  if(!BODY_TYPES.has(bt))throw new Error("bad body type");
  return{m,p,...(typeof v.b==="string"?{b:v.b}:{}),bt,b64:v.b64===true,t:Number(v.t),r:String(v.r??"")};
}
