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
 constructor(private readonly core:LayanXCore){
  const ownerIds=new Set((process.env.LAYANX_CHANNEL_OWNER_IDS??"").split(",").map(x=>x.trim()).filter(Boolean));
  const staffIds=new Set((process.env.LAYANX_CHANNEL_STAFF_IDS??"").split(",").map(x=>x.trim()).filter(Boolean));
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
  const reply=await this.router.handle(message);
  if(message.channel==="whatsapp")await this.whatsapp.sendText(message.chatId,reply);
  else await this.telegram.sendText(message.chatId,reply);
 }
}
