import type {LayanXCore} from "../core/orchestrator.js";
import {ChannelRouter} from "./router.js";
import {WhatsAppCloudAdapter} from "./whatsapp-cloud.js";
import {TelegramAdapter} from "./telegram.js";
import type {ChannelMessage} from "./types.js";

export class MessagingChannels{
 readonly whatsapp:WhatsAppCloudAdapter;
 readonly telegram:TelegramAdapter;
 readonly router:ChannelRouter;
 private started=false;
 private readonly processed=new Map<string,number>();
 private readonly dedupeTtlMs=300000;
 constructor(private readonly core:LayanXCore,private readonly flowHandler?: (message:ChannelMessage)=>Promise<boolean>){
  const ownerIds=new Set([...(process.env.LAYANX_CHANNEL_OWNER_IDS??"").split(","),...(process.env.LAYANX_WHATSAPP_OWNER_IDS??"").split(","),...(process.env.LAYANX_TELEGRAM_OWNER_IDS??"").split(",")].map(x=>x.trim()).filter(Boolean));
  const staffIds=new Set([...(process.env.LAYANX_CHANNEL_STAFF_IDS??"").split(","),...(process.env.LAYANX_WHATSAPP_STAFF_IDS??"").split(","),...(process.env.LAYANX_TELEGRAM_STAFF_IDS??"").split(",")].map(x=>x.trim()).filter(Boolean));
  this.router=new ChannelRouter(core,{ownerIds,staffIds});
  this.whatsapp=new WhatsAppCloudAdapter();
  this.telegram=new TelegramAdapter();
  this.telegram.onMessage(message=>this.handle(message));
 }
 async start(){
  if(this.started)return;
  this.started=true;
  if(process.env.LAYANX_WHATSAPP_ENABLED==="true")await this.whatsapp.start();
  if(process.env.LAYANX_TELEGRAM_ENABLED==="true")await this.telegram.start();
 }
 async stop(){await this.whatsapp.stop();await this.telegram.stop();this.started=false;}
 status(){return{whatsapp:this.whatsapp.status(),telegram:this.telegram.status(),started:this.started};}
 async handle(message:ChannelMessage){
  const key=`${message.channel}:${message.messageId}`;
  const now=Date.now();
  for(const [id,seenAt] of this.processed)if(now-seenAt>this.dedupeTtlMs)this.processed.delete(id);
  if(this.processed.has(key))return;
  this.processed.set(key,now);
  if(this.flowHandler&&await this.flowHandler(message))return;
  const reply=await this.router.handle(message);
  if(message.channel==="whatsapp")await this.whatsapp.sendText(message.chatId,reply);
  else await this.telegram.sendText(message.chatId,reply);
 }
}
