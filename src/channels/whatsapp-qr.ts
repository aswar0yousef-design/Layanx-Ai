import fs from "node:fs";
import path from "node:path";
import type {ChannelAdapter,ChannelMessage} from "./types.js";

/**
 * WhatsApp through a linked device, beside the official Cloud API. The owner scans a QR code with their own phone, as for
 * WhatsApp Web. This path is unofficial: WhatsApp may restrict or ban a number that uses it, so it is off until the owner
 * turns it on, it answers people who wrote first, and it sends slowly. The library is reached only through `QrConnector`.
 */
export type QrState="off"|"connecting"|"awaiting_scan"|"linked"|"reconnecting"|"logged_out"|"failed";
export interface QrInbound{id:string;chatId:string;senderId:string;text:string;fromMe:boolean;timestamp?:number}
export interface QrConnection{send(chatId:string,text:string):Promise<void>;close():Promise<void>}
export interface QrHandlers{onQr(code:string):void;onOpen(account?:string,alias?:string):void;onClose(reason:{loggedOut:boolean;detail:string}):void;onMessage(message:QrInbound):void}
export type QrConnector=(authDir:string,handlers:QrHandlers)=>Promise<QrConnection>;
export interface WhatsAppQrOptions{
  authDir:string;connector:QrConnector;
  /** Numbers the owner allows LayanX to write to first. Everyone else must have written first. */
  allowedFirstContact?:Iterable<string>;
  minGapMs?:number;maxPerHour?:number;maxReconnects?:number;baseDelayMs?:number;
  now?:()=>number;sleep?:(ms:number)=>Promise<void>;
}
const MAX_KNOWN=5000;
const number=(jid:string)=>jid.split("@")[0]!.split(":")[0]!;
const IGNORED_CHAT=/@g\.us$|@broadcast$|@newsletter$/;
const ECHO_MS=120_000;

export class WhatsAppQrAdapter implements ChannelAdapter{
  readonly kind="whatsapp" as const;
  private stateNow:QrState="off";
  private connection?:QrConnection;
  private qr?:string;
  private account?:string;
  private lastProblem?:string;
  private attempts=0;
  private timer?:NodeJS.Timeout;
  private stopping=false;
  private generation=0;
  private readonly known:Set<string>;
  private readonly allowed:Set<string>;
  private readonly listeners:Array<(message:ChannelMessage)=>void|Promise<void>>=[];
  private readonly sent:number[]=[];
  private readonly lastToChat=new Map<string,number>();
  private readonly self=new Set<string>();
  private readonly recentOut:Array<{chatId:string;text:string;at:number}>=[];
  private queue:Promise<unknown>=Promise.resolve();
  private readonly minGapMs:number;
  private readonly maxPerHour:number;
  private readonly maxReconnects:number;
  private readonly baseDelayMs:number;
  private readonly now:()=>number;
  private readonly sleep:(ms:number)=>Promise<void>;
  constructor(private readonly options:WhatsAppQrOptions){
    this.minGapMs=options.minGapMs??3000;this.maxPerHour=options.maxPerHour??60;this.maxReconnects=options.maxReconnects??6;this.baseDelayMs=options.baseDelayMs??2000;
    this.now=options.now??Date.now;this.sleep=options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
    this.allowed=new Set([...(options.allowedFirstContact??[])].map(number));
    this.known=new Set(this.readKnown());
  }
  private get knownFile(){return path.join(this.options.authDir,"known-chats.json");}
  private readKnown():string[]{try{const list=JSON.parse(fs.readFileSync(this.knownFile,"utf8"));return Array.isArray(list)?list.map(String):[];}catch{return[];}}
  private remember(chatId:string){
    if(this.known.has(chatId))return;
    this.known.add(chatId);
    if(this.known.size>MAX_KNOWN)this.known.delete(this.known.values().next().value!);
    fs.mkdirSync(this.options.authDir,{recursive:true,mode:0o700});
    fs.writeFileSync(this.knownFile,JSON.stringify([...this.known]),{mode:0o600});
  }
  onMessage(listener:(message:ChannelMessage)=>void|Promise<void>){this.listeners.push(listener);}
  get state(){return this.stateNow;}
  /** The current code for the owner's screen. Never logged, never in status(). */
  qrCode(){return this.stateNow==="awaiting_scan"?this.qr:undefined;}
  async start(){
    if(!["off","logged_out","failed"].includes(this.stateNow))return;
    this.stopping=false;this.attempts=0;this.lastProblem=undefined;
    await this.connect("connecting");
  }
  private async connect(state:QrState){
    const generation=++this.generation,live=()=>generation===this.generation&&!this.stopping;
    this.stateNow=state;
    fs.mkdirSync(this.options.authDir,{recursive:true,mode:0o700});
    try{
      const connection=await this.options.connector(this.options.authDir,{
        onQr:code=>{if(!live())return;this.qr=code;this.stateNow="awaiting_scan";},
        onOpen:(account,alias)=>{if(!live())return;this.qr=undefined;this.account=account?number(account):undefined;this.self.clear();for(const id of[account,alias])if(id)this.self.add(number(id));this.attempts=0;this.lastProblem=undefined;this.stateNow="linked";},
        onClose:reason=>{if(live())this.closed(reason);},
        onMessage:message=>{if(live())this.inbound(message);}
      });
      if(!live()){await connection.close().catch(()=>undefined);return;}
      this.connection=connection;
    }catch(error){if(live())this.closed({loggedOut:false,detail:(error as Error).message});}
  }
  private closed(reason:{loggedOut:boolean;detail:string}){
    this.connection=undefined;this.qr=undefined;this.lastProblem=reason.detail.slice(0,300);
    // A logged-out session never comes back by retrying; hammering the servers is what gets numbers flagged.
    if(reason.loggedOut){this.stateNow="logged_out";return;}
    if(++this.attempts>this.maxReconnects){this.stateNow="failed";return;}
    this.stateNow="reconnecting";
    this.timer=setTimeout(()=>{void this.connect("reconnecting");},this.baseDelayMs*2**(this.attempts-1));
    this.timer.unref?.();
  }
  private inbound(message:QrInbound){
    if(IGNORED_CHAT.test(message.chatId)||!message.text.trim())return;
    // The owner's own "message yourself" chat is how they command LayanX from the linked number. Nothing else they send counts.
    const selfChat=message.fromMe&&this.self.has(number(message.chatId));
    if(message.fromMe&&(!selfChat||this.isEcho(message.chatId,message.text)))return;
    this.remember(message.chatId);
    const normal:ChannelMessage={channel:"whatsapp",messageId:message.id,senderId:selfChat&&this.account?this.account:number(message.senderId),chatId:message.chatId,text:message.text.trim(),role:"unknown",timestamp:message.timestamp??0,transport:"qr",...(selfChat?{raw:{selfChat:true}}:{})};
    for(const listener of this.listeners)void Promise.resolve(listener(normal)).catch(()=>undefined);
  }
  /** A reply LayanX wrote into the self chat comes back as a message from the owner; answering it would loop forever. */
  private isEcho(chatId:string,text:string){
    const oldest=this.now()-ECHO_MS;
    while(this.recentOut.length&&this.recentOut[0]!.at<oldest)this.recentOut.shift();
    const found=this.recentOut.findIndex(item=>item.chatId===chatId&&item.text.trim()===text.trim());
    if(found<0)return false;
    this.recentOut.splice(found,1);
    return true;
  }
  private refusal(chatId:string):string|undefined{
    if(this.stateNow!=="linked"||!this.connection)return"whatsapp_qr_not_linked";
    if(!this.known.has(chatId)&&!this.allowed.has(number(chatId)))return"whatsapp_qr_first_contact_refused";
    const hourAgo=this.now()-3600_000;
    while(this.sent.length&&this.sent[0]!<hourAgo)this.sent.shift();
    return this.sent.length>=this.maxPerHour?"whatsapp_qr_hourly_limit":undefined;
  }
  /** One message at a time, and a pause between messages to the same chat. */
  sendText(chatId:string,text:string):Promise<void>{
    const run=this.queue.then(async()=>{
      const refused=this.refusal(chatId);
      if(refused)throw new Error(refused);
      const wait=(this.lastToChat.get(chatId)??-Infinity)+this.minGapMs-this.now();
      if(wait>0)await this.sleep(wait);
      this.recentOut.push({chatId,text,at:this.now()});
      await this.connection!.send(chatId,text);
      this.sent.push(this.now());this.lastToChat.set(chatId,this.now());
    });
    this.queue=run.catch(()=>undefined);
    return run;
  }
  async stop(){
    this.stopping=true;this.generation++;
    if(this.timer)clearTimeout(this.timer);
    const connection=this.connection;this.connection=undefined;this.qr=undefined;this.stateNow="off";
    await connection?.close().catch(()=>undefined);
  }
  /** Forgets this device's link. The owner should also remove the device in WhatsApp on the phone. */
  async unlink(){
    await this.stop();
    fs.rmSync(this.options.authDir,{recursive:true,force:true});
    this.known.clear();this.account=undefined;this.lastProblem=undefined;
  }
  status(){return{method:"qr",state:this.stateNow,linked:this.stateNow==="linked",qrAvailable:Boolean(this.qrCode()),account:this.account,knownChats:this.known.size,sentLastHour:this.sent.filter(at=>at>this.now()-3600_000).length,maxPerHour:this.maxPerHour,lastProblem:this.lastProblem,unofficial:true};}
}
