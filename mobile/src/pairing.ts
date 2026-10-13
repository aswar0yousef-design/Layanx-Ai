/**
 * The QR code on the PC's setup page:
 *   layanx://pair?v=1&c=<code>&p=<certificate pin>&n=<computer>&u=<url>&u=<url>
 * Parsed by hand: React Native's URLSearchParams is incomplete.
 */
export type PairingLink={code:string;pin:string|null;computer:string;urls:string[]};

export function parsePairingLink(text:string):PairingLink|null{
  const m=/^layanx:\/\/pair\?(.+)$/.exec(text.trim());
  if(!m)return null;
  const values:Record<string,string[]>={};
  for(const part of (m[1]??"").split("&")){
    const i=part.indexOf("=");if(i<1)continue;
    // A code from elsewhere may be malformed: skip the part, never throw from the scanner.
    let k="",v="";try{k=decodeURIComponent(part.slice(0,i));v=decodeURIComponent(part.slice(i+1).replace(/\+/g," "));}catch{continue;}
    (values[k]??=[]).push(v);
  }
  if(values.v?.[0]!=="1")return null;
  const code=(values.c?.[0]??"").toUpperCase().replace(/[^A-Z0-9]/g,"");
  if(code.length!==8)return null;
  const pin=values.p?.[0]??null;
  if(pin!==null&&!/^[A-Za-z0-9_-]{43}$/.test(pin))return null;
  const urls=(values.u??[]).filter(u=>/^https:\/\/[^\s/]+(:\d+)?$/.test(u)).slice(0,6);
  if(!urls.length)return null;
  return{code,pin,computer:(values.n?.[0]??"").slice(0,40),urls};
}

/** Addresses that are IPs need the pinned certificate; names (*.ts.net, a tunnel) have real ones. */
export function isIpAddress(url:string):boolean{
  const host=/^https?:\/\/(\[[^\]]+\]|[^/:]+)/.exec(url)?.[1]??"";
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host)||host.startsWith("[");
}
