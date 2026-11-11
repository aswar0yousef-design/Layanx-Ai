export type ChannelKind="whatsapp"|"telegram";
export type ChannelRole="owner"|"staff"|"customer"|"unknown";
export interface ChannelMessage{
 channel:ChannelKind;
 messageId:string;
 senderId:string;
 chatId:string;
 text:string;
 role:ChannelRole;
 timestamp?:number;
 /** Which WhatsApp path it came through, so the reply leaves the same way. */
 transport?:"cloud"|"qr";
 raw?:unknown;
}
export interface ChannelReply{
 chatId:string;
 text:string;
}
export interface ChannelAdapter{
 readonly kind:ChannelKind;
 start():Promise<void>;
 stop():Promise<void>;
 sendText(chatId:string,text:string):Promise<void>;
 status():Record<string,unknown>;
}
export interface ChannelPolicy{
 ownerIds:Set<string>;
 staffIds:Set<string>;
}
