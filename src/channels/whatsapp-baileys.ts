import type {QrConnector} from "./whatsapp-qr.js";

/** Kept apart so the rest of LayanX, and every test, works without this library. It is loaded only when the owner links a number. */
const LIBRARY="@whiskeysockets/baileys";
const silent:any={level:"silent",trace(){},debug(){},info(){},warn(){},error(){},fatal(){},child(){return silent;}};
const textOf=(message:any):string=>message?.conversation??message?.extendedTextMessage?.text??"";
export const WHATSAPP_PHONE_JID=/@s\.whatsapp\.net$/;

export const baileysConnector:QrConnector=async(authDir,handlers)=>{
  const library:any=await import(LIBRARY).catch(()=>{throw new Error("whatsapp_qr_library_missing");});
  const makeSocket=library.default??library.makeWASocket;
  const {state,saveCreds}=await library.useMultiFileAuthState(authDir);
  const socket=makeSocket({auth:state,logger:silent,printQRInTerminal:false,syncFullHistory:false,markOnlineOnConnect:false});
  socket.ev.on("creds.update",saveCreds);
  socket.ev.on("connection.update",(update:any)=>{
    if(update.qr)handlers.onQr(update.qr);
    if(update.connection==="open")handlers.onOpen(socket.user?.id,socket.user?.lid);
    if(update.connection==="close"){
      const code=update.lastDisconnect?.error?.output?.statusCode;
      handlers.onClose({loggedOut:code===library.DisconnectReason?.loggedOut,detail:"connection closed: "+String(code??"unknown")});
    }
  });
  socket.ev.on("messages.upsert",({messages,type}:any)=>{
    for(const item of messages??[]){
      // What the owner sends from the phone can arrive as "append"; old messages must not replay as new commands.
      if(type!=="notify"&&!(item.key?.fromMe&&Date.now()/1000-Number(item.messageTimestamp??0)<120))continue;
      const chatId=String(item.key?.remoteJid??"");
      // Newer WhatsApp accounts arrive under a private id; the phone number, when present, is what owner lists contain.
      const alternate=item.key?.senderPn??item.key?.remoteJidAlt;
      handlers.onMessage({id:String(item.key?.id??""),chatId,senderId:String(alternate??item.key?.participant??chatId),text:textOf(item.message),fromMe:Boolean(item.key?.fromMe),timestamp:Number(item.messageTimestamp??0)});
    }
  });
  return{
    async send(chatId,text){await socket.sendMessage(chatId,{text});},
    async close(){socket.end?.(undefined);}
  };
};
