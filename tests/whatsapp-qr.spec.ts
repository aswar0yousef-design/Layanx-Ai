import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {WhatsAppQrAdapter,type QrHandlers} from "../src/channels/whatsapp-qr.js";

const root=fs.mkdtempSync(path.join(os.tmpdir(),"wa-qr-"));
let folder=0;
const tick=(ms=20)=>new Promise(resolve=>setTimeout(resolve,ms));
function setup(extra:Record<string,unknown>={}){
  const authDir=path.join(root,String(++folder)),sent:string[]=[],sockets:QrHandlers[]=[];let closed=0,clock=1000;const slept:number[]=[];
  const adapter=new WhatsAppQrAdapter({authDir,baseDelayMs:1,maxReconnects:2,now:()=>clock,sleep:async ms=>{slept.push(ms);clock+=ms;},
    connector:async(_dir,handlers)=>{sockets.push(handlers);return{send:async(chat,text)=>{sent.push(chat+"|"+text);},close:async()=>{closed++;}};},...extra});
  return{adapter,sent,sockets,authDir,slept,closes:()=>closed,advance:(ms:number)=>{clock+=ms;}};
}
const socket="966500000001@s.whatsapp.net";
const hello=(over:Record<string,unknown>={})=>({id:"1",chatId:socket,senderId:socket,text:"hi",fromMe:false,...over});

{ // Off until started; the code is available while waiting and never in status.
  const s=setup();
  assert.equal(s.adapter.state,"off");
  await s.adapter.start();
  assert.equal(s.adapter.state,"connecting");
  s.sockets[0]!.onQr("secret-code");
  assert.equal(s.adapter.state,"awaiting_scan");
  assert.equal(s.adapter.qrCode(),"secret-code");
  assert.ok(!JSON.stringify(s.adapter.status()).includes("secret-code"));
  assert.equal(s.adapter.status().qrAvailable,true);
  s.sockets[0]!.onOpen("966500000009:12@s.whatsapp.net");
  assert.equal(s.adapter.state,"linked");
  assert.equal(s.adapter.qrCode(),undefined);
  assert.equal(s.adapter.status().account,"966500000009");
  assert.equal(s.adapter.status().unofficial,true);
}
{ // Only real private text reaches LayanX, and the sender is a plain number that owner lists can match.
  const s=setup(),got:any[]=[];
  s.adapter.onMessage(message=>{got.push(message);});
  await s.adapter.start();s.sockets[0]!.onOpen();
  s.sockets[0]!.onMessage(hello({fromMe:true}));
  s.sockets[0]!.onMessage(hello({chatId:"123@g.us"}));
  s.sockets[0]!.onMessage(hello({chatId:"status@broadcast"}));
  s.sockets[0]!.onMessage(hello({text:"  "}));
  assert.equal(got.length,0);
  s.sockets[0]!.onMessage(hello());
  assert.equal(got.length,1);
  assert.equal(got[0].senderId,"966500000001");
  assert.equal(got[0].transport,"qr");
  assert.equal(got[0].role,"unknown");
}
{ // Nobody gets a first message unless the owner listed them; whoever wrote first can be answered.
  const s=setup({allowedFirstContact:["966500000002"]});
  await assert.rejects(s.adapter.sendText(socket,"x"),/not_linked/);
  await s.adapter.start();s.sockets[0]!.onOpen();
  await assert.rejects(s.adapter.sendText(socket,"x"),/first_contact_refused/);
  await s.adapter.sendText("966500000002@s.whatsapp.net","ok");
  s.sockets[0]!.onMessage(hello());
  await s.adapter.sendText(socket,"reply");
  assert.deepEqual(s.sent,["966500000002@s.whatsapp.net|ok",socket+"|reply"]);
}
{ // Known chats survive a restart of LayanX.
  const s=setup();
  await s.adapter.start();s.sockets[0]!.onOpen();s.sockets[0]!.onMessage(hello());await s.adapter.stop();
  const again=new WhatsAppQrAdapter({authDir:s.authDir,connector:async(_d,h)=>{h.onOpen();return{send:async()=>{},close:async()=>{}};}});
  await again.start();
  await again.sendText(socket,"still known");
  assert.equal(again.status().knownChats,1);
  await again.stop();
}
{ // Sends are paced per chat and capped per hour, and a refused send does not block the next.
  const s=setup({maxPerHour:2,minGapMs:5000});
  await s.adapter.start();s.sockets[0]!.onOpen();s.sockets[0]!.onMessage(hello());
  await Promise.all([s.adapter.sendText(socket,"a"),s.adapter.sendText(socket,"b")]);
  assert.deepEqual(s.slept,[5000]);
  assert.deepEqual(s.sent.map(x=>x.split("|")[1]),["a","b"]);
  await assert.rejects(s.adapter.sendText(socket,"c"),/hourly_limit/);
  s.advance(3700_000);
  await s.adapter.sendText(socket,"d");
  assert.equal(s.sent.length,3);
}
{ // A dropped connection retries with a limit; being logged out does not retry at all.
  const s=setup();
  await s.adapter.start();s.sockets[0]!.onOpen();
  s.sockets[0]!.onClose({loggedOut:false,detail:"net"});
  assert.equal(s.adapter.state,"reconnecting");
  await tick();
  assert.equal(s.sockets.length,2);
  s.sockets[1]!.onOpen();
  assert.equal(s.adapter.state,"linked");
  s.sockets[1]!.onClose({loggedOut:false,detail:"1"});await tick();
  s.sockets[2]!.onClose({loggedOut:false,detail:"2"});await tick(30);
  s.sockets[3]!.onClose({loggedOut:false,detail:"3"});await tick();
  assert.equal(s.adapter.state,"failed");
  assert.equal(s.sockets.length,4);
  const out=setup();
  await out.adapter.start();out.sockets[0]!.onOpen();
  out.sockets[0]!.onClose({loggedOut:true,detail:"401"});await tick();
  assert.equal(out.adapter.state,"logged_out");
  assert.equal(out.sockets.length,1);
}
{ // A connector that cannot even load is reported, and start can be tried again.
  const s=setup({maxReconnects:0,connector:async()=>{throw new Error("whatsapp_qr_library_missing");}});
  await s.adapter.start();
  assert.equal(s.adapter.state,"failed");
  assert.match(String(s.adapter.status().lastProblem),/library_missing/);
}
{ // Stop ends everything, late events from the old socket change nothing, and unlink removes the saved link.
  const s=setup();
  await s.adapter.start();s.sockets[0]!.onOpen();
  await s.adapter.stop();
  assert.equal(s.closes(),1);
  s.sockets[0]!.onOpen();s.sockets[0]!.onClose({loggedOut:false,detail:"late"});await tick();
  assert.equal(s.adapter.state,"off");
  assert.equal(s.sockets.length,1);
  fs.writeFileSync(path.join(s.authDir,"creds.json"),"{}");
  await s.adapter.unlink();
  assert.equal(fs.existsSync(s.authDir),false);
}
fs.rmSync(root,{recursive:true,force:true});
console.log("whatsapp-qr: linking, filtering, first-contact refusal, pacing, reconnect limits and unlinking behave");
process.exit(0);
