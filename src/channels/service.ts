import fs from "node:fs";
import path from "node:path";
import type {LayanXCore} from "../core/orchestrator.js";
import {ChannelRouter} from "./router.js";
import {WhatsAppCloudAdapter} from "./whatsapp-cloud.js";
import {TelegramAdapter} from "./telegram.js";
import {WhatsAppQrAdapter,type QrConnector} from "./whatsapp-qr.js";
import {baileysConnector} from "./whatsapp-baileys.js";
import {addressFor,bareNumber,chooseWhatsAppPath,WhatsAppMethods,type WhatsAppPath} from "./whatsapp-route.js";
import type {ChannelMessage} from "./types.js";

const list=(...values:Array<string|undefined>)=>values.flatMap(value=>(value??"").split(",")).map(x=>x.trim()).filter(Boolean);
export class MessagingChannels{
 readonly whatsapp:WhatsAppCloudAdapter;
 readonly whatsappQr:WhatsAppQrAdapter;
 readonly methods:WhatsAppMethods;
 readonly telegram:TelegramAdapter;
 readonly router:ChannelRouter;
 private started=false;
 private readonly processed=new Map<string,number>();
 private readonly dedupeTtlMs=300000;
 private readonly lastPath=new Map<string,WhatsAppPath>();
 private readonly ownerIds:Set<string>;
 private readonly qrDir:string;
 constructor(private readonly core:LayanXCore,private readonly flowHandler?: (message:ChannelMessage)=>Promise<boolean>,options:{qrConnector?:QrConnector;storeDir?:string}={}){
  const env=process.env;
  this.ownerIds=new Set(list(env.LAYANX_CHANNEL_OWNER_IDS,env.LAYANX_WHATSAPP_OWNER_IDS,env.LAYANX_TELEGRAM_OWNER_IDS));
  const staffIds=new Set(list(env.LAYANX_CHANNEL_STAFF_IDS,env.LAYANX_WHATSAPP_STAFF_IDS,env.LAYANX_TELEGRAM_STAFF_IDS));
  this.router=new ChannelRouter(core,{ownerIds:this.ownerIds,staffIds});
  this.whatsapp=new WhatsAppCloudAdapter();
  this.telegram=new TelegramAdapter();
  this.telegram.onMessage(message=>this.handle(message));
  const storeDir=options.storeDir??(env.LAYANX_STORE_DIR?.trim()||".layanx");
  this.qrDir=path.join(storeDir,"whatsapp-qr");
  this.methods=new WhatsAppMethods(path.join(storeDir,"whatsapp-methods.json"));
  this.whatsappQr=new WhatsAppQrAdapter({authDir:this.qrDir,connector:options.qrConnector??baileysConnector,allowedFirstContact:list(env.LAYANX_WHATSAPP_QR_ALLOWED)});
  this.whatsappQr.onMessage(message=>this.handle(message));
 }
 async start(){
  if(this.started)return;
  this.started=true;
  if(process.env.LAYANX_WHATSAPP_ENABLED==="true")await this.whatsapp.start();
  if(process.env.LAYANX_TELEGRAM_ENABLED==="true")await this.telegram.start();
  // Linking is the owner's act on the setup page. After that the link comes back by itself at every start.
  if(process.env.LAYANX_WHATSAPP_QR!=="off"&&fs.existsSync(path.join(this.qrDir,"creds.json")))await this.whatsappQr.start();
 }
 async stop(){await this.whatsapp.stop();await this.whatsappQr.stop();await this.telegram.stop();this.started=false;}
 status(){return{whatsapp:this.whatsapp.status(),whatsappQr:this.whatsappQr.status(),telegram:this.telegram.status(),started:this.started};}
 /** Sends by the path the owner chose for this number, else the one it last wrote through, else the default. */
 async sendWhatsApp(chatId:string,text:string,asked?:WhatsAppPath){
  const via=chooseWhatsAppPath({asked,owner:this.methods.get(chatId),last:this.lastPath.get(bareNumber(chatId)),fallback:process.env.LAYANX_WHATSAPP_DEFAULT_METHOD==="qr"?"qr":"cloud",available:{cloud:this.whatsapp.status().enabled,qr:this.whatsappQr.state==="linked"}});
  if(via==="qr")await this.whatsappQr.sendText(addressFor(chatId,"qr"),text);
  else await this.whatsapp.sendText(addressFor(chatId,"cloud"),text);
 }
 async handle(message:ChannelMessage){
  const key=`${message.channel}:${message.messageId}`;
  const now=Date.now();
  for(const [id,seenAt] of this.processed)if(now-seenAt>this.dedupeTtlMs)this.processed.delete(id);
  if(this.processed.has(key))return;
  this.processed.set(key,now);
  if(message.transport==="qr"){
   // Only the person holding the linked phone can write in its own chat.
   if((message.raw as {selfChat?:boolean}|undefined)?.selfChat)this.ownerIds.add(message.senderId);
   // A linked number is often someone's personal number: nobody there signed up to talk to a bot.
   if(this.router.roleFor(message.senderId)==="customer"&&process.env.LAYANX_WHATSAPP_QR_ANSWER_CUSTOMERS!=="true")return;
  }
  if(message.channel==="whatsapp")this.lastPath.set(bareNumber(message.chatId),message.transport??"cloud");
  if(this.flowHandler&&await this.flowHandler(message))return;
  const reply=await this.router.handle(message);
  if(message.channel==="whatsapp")await this.sendWhatsApp(message.chatId,reply,message.transport??"cloud");
  else await this.telegram.sendText(message.chatId,reply);
 }
}
