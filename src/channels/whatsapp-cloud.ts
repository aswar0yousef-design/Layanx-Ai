import type {ChannelAdapter} from "./types.js";
import {randomUUID} from "node:crypto";

export interface WhatsAppCloudOptions{
 token?:string;
 phoneNumberId?:string;
 verifyToken?:string;
 graphVersion?:string;
 graphBaseUrl?:string;
}

export class WhatsAppCloudAdapter implements ChannelAdapter{
 readonly kind="whatsapp" as const;
 private running=false;
 private readonly token:string;
 private readonly phoneNumberId:string;
 private readonly verifyToken:string;
 private readonly graphVersion:string;
 private readonly graphBaseUrl:string;
 constructor(options:WhatsAppCloudOptions={}){
  this.token=options.token??process.env.LAYANX_WHATSAPP_ACCESS_TOKEN??"";
  this.phoneNumberId=options.phoneNumberId??process.env.LAYANX_WHATSAPP_PHONE_NUMBER_ID??"";
  this.verifyToken=options.verifyToken??process.env.LAYANX_WHATSAPP_VERIFY_TOKEN??"";
  this.graphVersion=options.graphVersion??process.env.LAYANX_WHATSAPP_GRAPH_VERSION??"v23.0";
  this.graphBaseUrl=(options.graphBaseUrl??process.env.LAYANX_WHATSAPP_GRAPH_BASE_URL??"https://graph.facebook.com").replace(/\/$/,"");
 }
 start(){this.running=true;return Promise.resolve();}
 stop(){this.running=false;return Promise.resolve();}
 status(){return{enabled:Boolean(this.token&&this.phoneNumberId),running:this.running,phoneNumberIdConfigured:Boolean(this.phoneNumberId),tokenConfigured:Boolean(this.token),verifyTokenConfigured:Boolean(this.verifyToken),graphVersion:this.graphVersion};}
 verify(mode:string,token:string,challenge:string){if(mode!=="subscribe"||!this.verifyToken||token!==this.verifyToken)throw new Error("whatsapp_webhook_verification_failed");return challenge;}
 async sendText(chatId:string,text:string){
  if(!this.token||!this.phoneNumberId)throw new Error("whatsapp_credentials_missing");
  const response=await fetch(`${this.graphBaseUrl}/${this.graphVersion}/${this.phoneNumberId}/messages`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${this.token}`},body:JSON.stringify({messaging_product:"whatsapp",to:chatId,type:"text",text:{body:text}})});
  if(!response.ok)throw new Error(`whatsapp_send_failed:${response.status}:${await response.text()}`);
 }
 parseWebhook(body:any){
  const value=body?.entry?.[0]?.changes?.[0]?.value;
  const message=value?.messages?.[0];
  if(!message||message.type!=="text")return null;
  return{channel:"whatsapp" as const,messageId:String(message.id??randomUUID()),senderId:String(message.from),chatId:String(message.from),text:String(message.text?.body??"").trim(),role:"unknown" as const,timestamp:Number(message.timestamp??0),raw:body};
 }
}
