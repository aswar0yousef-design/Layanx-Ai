import fs from "node:fs";
import path from "node:path";

/**
 * Which WhatsApp path a message leaves by. The owner's choice for a number comes first, then the path that number last wrote
 * through, then the default. A path that is not working is never chosen while the other one works.
 */
export type WhatsAppPath="cloud"|"qr";
export const bareNumber=(id:string)=>id.split("@")[0]!.split(":")[0]!.replace(/^\+/,"");
/** The QR path addresses people by a full id; the Cloud API by the number alone. */
export const addressFor=(chatId:string,via:WhatsAppPath)=>via==="cloud"?bareNumber(chatId):chatId.includes("@")?chatId:`${bareNumber(chatId)}@s.whatsapp.net`;

export function chooseWhatsAppPath(input:{asked?:WhatsAppPath;owner?:WhatsAppPath;last?:WhatsAppPath;fallback?:WhatsAppPath;available:Record<WhatsAppPath,boolean>}):WhatsAppPath{
  const wanted=input.asked??input.owner??input.last??input.fallback??"cloud";
  if(input.asked||input.available[wanted])return wanted;
  const other:WhatsAppPath=wanted==="cloud"?"qr":"cloud";
  return input.available[other]?other:wanted;
}
export class WhatsAppMethods{
  private methods:Record<string,WhatsAppPath>;
  constructor(private readonly file:string){
    try{this.methods=JSON.parse(fs.readFileSync(file,"utf8"));}catch{this.methods={};}
  }
  get(chatId:string):WhatsAppPath|undefined{return this.methods[bareNumber(chatId)];}
  list(){return{...this.methods};}
  set(chatId:string,via:WhatsAppPath|null){
    const key=bareNumber(chatId);
    if(!/^\d{8,15}$/.test(key))throw new Error("whatsapp_invalid_number");
    if(via===null)delete this.methods[key];
    else if(via==="cloud"||via==="qr")this.methods[key]=via;
    else throw new Error("whatsapp_invalid_method");
    fs.mkdirSync(path.dirname(this.file),{recursive:true});
    fs.writeFileSync(this.file,JSON.stringify(this.methods,null,2),{mode:0o600});
    return this.list();
  }
}
