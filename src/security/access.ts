import crypto from "node:crypto";
import fs from "node:fs";
import {readJsonFile,writeFileAtomic} from "../platform/paths.js";

/**
 * Who may talk to THIS installation.
 *
 *  - master token   : random per install, kept in the secret store, used by
 *                     the local CLI. Accepted from loopback only.
 *  - launch ticket  : one-time code written to a user-only file by the
 *                     desktop launcher, exchanged by the browser for a session.
 *  - browser session: HttpOnly cookie, loopback only, 12h.
 *  - device token   : issued to a phone after pairing with a short-lived code
 *                     shown on this computer. Stored only as a SHA-256 hash.
 *
 * Nothing here is shared between installations: two people who download the
 * same repository get different tokens, codes and device lists, so a phone
 * paired with one computer can never control another.
 */
export interface DeviceRecord{id:string;name:string;tokenHash:string;createdAt:string;lastSeenAt?:string}
export type PublicDevice=Omit<DeviceRecord,"tokenHash">;

const CODE_ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PAIRING_TTL_MS=5*60_000;
const PAIRING_MAX_FAILURES=5;
const RATE_WINDOW_MS=10*60_000;
const RATE_MAX=10;
const LAUNCH_TTL_MS=2*60_000;
const SESSION_TTL_MS=12*60*60_000;

export const hashToken=(token:string)=>crypto.createHash("sha256").update(token,"utf8").digest("hex");
export const randomToken=(prefix:string)=>prefix+crypto.randomBytes(32).toString("base64url");

function sameHash(a:string,b:string):boolean{
  const x=Buffer.from(a,"hex"),y=Buffer.from(b,"hex");
  return x.length===y.length&&x.length>0&&crypto.timingSafeEqual(x,y);
}
function randomCode(length:number):string{
  let out="";
  const bytes=crypto.randomBytes(length);
  for(const byte of bytes)out+=CODE_ALPHABET[byte%CODE_ALPHABET.length];
  return out;
}
export function normalizePairingCode(code:unknown):string{
  return typeof code==="string"?code.toUpperCase().replace(/[\s-]/g,""):"";
}

export type PairingResult=
  |{ok:true;deviceId:string;deviceToken:string}
  |{ok:false;status:400|401|410|429;error:string};

export interface AccessManagerOptions{
  devicesFile:string;
  launchTicketFile:string;
  masterToken:string;
  /** Persist browser-session hashes so a restart does not log the owner out. */
  sessionsFile?:string;
  now?:()=>number;
}

export class AccessManager{
  private readonly devicesFile:string;
  private readonly launchTicketFile:string;
  private readonly sessionsFile:string|undefined;
  private readonly masterHash:string;
  private readonly now:()=>number;
  private devices:DeviceRecord[];
  private pairing:{hash:string;expiresAt:number;failures:number}|null=null;
  private readonly launchTickets=new Map<string,number>();
  private readonly sessions=new Map<string,number>();
  private readonly attempts=new Map<string,{count:number;resetAt:number}>();
  private lastSeenFlush=0;

  constructor(options:AccessManagerOptions){
    this.devicesFile=options.devicesFile;
    this.launchTicketFile=options.launchTicketFile;
    this.masterHash=hashToken(options.masterToken);
    this.now=options.now??Date.now;
    this.devices=readJsonFile<{devices?:DeviceRecord[]}>(this.devicesFile,{}).devices??[];
    this.sessionsFile=options.sessionsFile;
    if(this.sessionsFile){
      const saved=readJsonFile<{sessions?:Record<string,number>}>(this.sessionsFile,{}).sessions??{};
      const now=this.now();
      for(const [hash,expiresAt] of Object.entries(saved))if(typeof expiresAt==="number"&&expiresAt>now)this.sessions.set(hash,expiresAt);
    }
  }

  isMasterToken(token:string):boolean{return sameHash(hashToken(token),this.masterHash);}

  // ---------- devices ----------
  listDevices():PublicDevice[]{return this.devices.map(({tokenHash:_hash,...rest})=>rest);}

  verifyDeviceToken(token:string):PublicDevice|null{
    if(!token.startsWith("lxd_"))return null;
    const hash=hashToken(token);
    const device=this.devices.find(d=>sameHash(d.tokenHash,hash));
    if(!device)return null;
    const now=this.now();
    device.lastSeenAt=new Date(now).toISOString();
    if(now-this.lastSeenFlush>60_000){this.lastSeenFlush=now;this.saveDevices();}
    const {tokenHash:_hash,...rest}=device;
    return rest;
  }

  revokeDevice(id:string):boolean{
    const before=this.devices.length;
    this.devices=this.devices.filter(d=>d.id!==id);
    if(this.devices.length===before)return false;
    this.saveDevices();
    return true;
  }

  // ---------- pairing ----------
  startPairing():{code:string;expiresAt:string}{
    const code=randomCode(8);
    const expiresAt=this.now()+PAIRING_TTL_MS;
    this.pairing={hash:hashToken(code),expiresAt,failures:0};
    return{code:code.slice(0,4)+"-"+code.slice(4),expiresAt:new Date(expiresAt).toISOString()};
  }

  cancelPairing():void{this.pairing=null;}

  completePairing(rawCode:unknown,rawName:unknown,remoteKey:string):PairingResult{
    if(!this.allowAttempt(remoteKey))return{ok:false,status:429,error:"Too many pairing attempts. Wait 10 minutes."};
    const code=normalizePairingCode(rawCode);
    if(code.length!==8)return{ok:false,status:400,error:"Pairing code must be 8 characters."};
    const active=this.pairing;
    if(!active||active.expiresAt<this.now()){this.pairing=null;return{ok:false,status:410,error:"No active pairing code. Create a new one on the computer."};}
    if(!sameHash(hashToken(code),active.hash)){
      active.failures++;
      if(active.failures>=PAIRING_MAX_FAILURES)this.pairing=null;
      return{ok:false,status:401,error:"Wrong pairing code."};
    }
    this.pairing=null;
    const deviceToken=randomToken("lxd_");
    const device:DeviceRecord={
      id:"dev_"+crypto.randomBytes(6).toString("hex"),
      name:sanitizeDeviceName(rawName),
      tokenHash:hashToken(deviceToken),
      createdAt:new Date(this.now()).toISOString()
    };
    this.devices.push(device);
    this.saveDevices();
    return{ok:true,deviceId:device.id,deviceToken};
  }

  // ---------- launcher + browser sessions ----------
  /** Writes a one-time code into a file only this Windows user can read. */
  issueLaunchTicket():{expiresAt:string}{
    const code=crypto.randomBytes(24).toString("base64url");
    const expiresAt=this.now()+LAUNCH_TTL_MS;
    this.prune();
    this.launchTickets.set(hashToken(code),expiresAt);
    writeFileAtomic(this.launchTicketFile,JSON.stringify({code,expiresAt:new Date(expiresAt).toISOString()}));
    return{expiresAt:new Date(expiresAt).toISOString()};
  }

  exchangeLaunchTicket(code:unknown):string|null{
    if(typeof code!=="string"||code.length<16||code.length>128)return null;
    const hash=hashToken(code);
    const expiresAt=this.launchTickets.get(hash);
    this.launchTickets.delete(hash);
    if(!expiresAt||expiresAt<this.now())return null;
    try{fs.rmSync(this.launchTicketFile,{force:true});}catch{}
    const session=randomToken("lxs_");
    this.sessions.set(hashToken(session),this.now()+SESSION_TTL_MS);
    this.saveSessions();
    return session;
  }

  verifySession(token:string):boolean{
    if(!token.startsWith("lxs_"))return false;
    const expiresAt=this.sessions.get(hashToken(token));
    if(!expiresAt)return false;
    if(expiresAt<this.now()){this.sessions.delete(hashToken(token));return false;}
    return true;
  }

  endSession(token:string):void{this.sessions.delete(hashToken(token));this.saveSessions();}

  // ---------- helpers ----------
  private allowAttempt(key:string):boolean{
    const now=this.now();
    const entry=this.attempts.get(key);
    if(!entry||entry.resetAt<now){this.attempts.set(key,{count:1,resetAt:now+RATE_WINDOW_MS});return true;}
    entry.count++;
    return entry.count<=RATE_MAX;
  }
  private prune(){
    const now=this.now();
    for(const [k,v] of this.launchTickets)if(v<now)this.launchTickets.delete(k);
    for(const [k,v] of this.sessions)if(v<now)this.sessions.delete(k);
  }
  private saveSessions(){
    if(!this.sessionsFile)return;
    writeFileAtomic(this.sessionsFile,JSON.stringify({sessions:Object.fromEntries(this.sessions)}));
  }
  private saveDevices(){writeFileAtomic(this.devicesFile,JSON.stringify({devices:this.devices},null,2));}
}

function sanitizeDeviceName(value:unknown):string{
  const text=typeof value==="string"?value.replace(/[\u0000-\u001f\u007f<>]/g,"").trim():"";
  return (text||"Phone").slice(0,60);
}
