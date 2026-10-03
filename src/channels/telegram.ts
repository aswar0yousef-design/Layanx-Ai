import type {ChannelAdapter} from "./types.js";
import {randomUUID} from "node:crypto";

export interface TelegramOptions{token?:string;pollIntervalMs?:number;}
export class TelegramAdapter implements ChannelAdapter{
 readonly kind="telegram" as const;
 private running=false;
 private offset=0;
 private timer?:ReturnType<typeof setTimeout>;
 private readonly token:string;
 private readonly pollIntervalMs:number;
 private handler?: (message:any)=>Promise<void>;
 constructor(options:TelegramOptions={}){
  this.token=options.token??process.env.LAYANX_TELEGRAM_BOT_TOKEN??"";
  this.pollIntervalMs=options.pollIntervalMs??Number(process.env.LAYANX_TELEGRAM_POLL_INTERVAL_MS??1000);
 }
 onMessage(handler:(message:any)=>Promise<void>){this.handler=handler;}
 private api(method:string){if(!this.token)throw new Error("telegram_bot_token_missing");return`https://api.telegram.org/bot${this.token}/${method}`;}
 async start(){
  if(!this.token){this.running=false;return;}
  this.running=true;
  void this.poll();
 }
 async stop(){this.running=false;if(this.timer)clearTimeout(this.timer);}
 status(){return{enabled:Boolean(this.token),running:this.running,transport:"long_polling"};}
 async sendText(chatId:string,text:string){
  if(!this.token)throw new Error("telegram_bot_token_missing");
  const response=await fetch(this.api("sendMessage"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chatId,text})});
  if(!response.ok)throw new Error(`telegram_send_failed:${response.status}:${await response.text()}`);
 }
 private async poll(){
  if(!this.running)return;
  try{
   const response=await fetch(this.api(`getUpdates?timeout=25&offset=${this.offset}&allowed_updates=%5B%22message%22%5D`));
   if(response.ok){
    const payload=await response.json() as {ok:boolean;result?:any[]};
    for(const update of payload.result??[]){
     this.offset=Math.max(this.offset,Number(update.update_id??0)+1);
     const message=update.message;
     const text=typeof message?.text==="string"?message.text.trim():"";
     if(text&&this.handler)await this.handler({channel:"telegram",messageId:String(update.update_id??randomUUID()),senderId:String(message.from?.id??""),chatId:String(message.chat?.id??""),text,role:"unknown",timestamp:Number(message.date??0),raw:update});
    }
   }
  }catch{}
  if(this.running)this.timer=setTimeout(()=>void this.poll(),this.pollIntervalMs);
 }
}
