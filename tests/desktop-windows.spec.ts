import assert from "node:assert/strict";
import {createDesktopControlToolAdapter} from "../src/tools/desktop-control.js";

// Exercise the Windows code path on any OS with a fake backend.
const real=Object.getOwnPropertyDescriptor(process,"platform")!;
Object.defineProperty(process,"platform",{value:"win32"});
try{
  const ops:any[]=[];
  const adapter=createDesktopControlToolAdapter({windows:{async send(op){ops.push(op);return op.op==="shot"?Buffer.from("jpeg-bytes").toString("base64")+"|2560x1440":"ok";}}});
  const req=(action:string,payload:Record<string,unknown>)=>({missionId:"m",agentId:"core",projectId:"p",tool:"t",action,permission:"L4_EXECUTE",idempotencyKey:"k",payload} as any);

  const evil='مرحبا"; Remove-Item -Recurse C:\\ ; $(calc)';
  await adapter.execute(req("desktop type",{text:evil}));
  const typed=ops.at(-1);
  assert.equal(typed.op,"type");
  assert.equal(Buffer.from(typed.text,"base64").toString("utf8"),evil,"typed text travels base64-encoded, never as PowerShell code");
  assert.ok(!JSON.stringify(typed).includes("Remove-Item"));

  await adapter.execute(req("desktop click",{x:10,y:20,button:"right",double:true}));
  assert.deepEqual({op:ops.at(-1).op,right:ops.at(-1).right,double:ops.at(-1).double},{op:"click",right:true,double:true});
  assert.equal((await adapter.execute(req("desktop press key",{key:"ctrl+shift+esc"})) as any).key,"CTRL+SHIFT+ESC");
  await assert.rejects(adapter.execute(req("desktop press key",{key:"CTRL+;rm"})),/Unsupported keyboard key/);
  await assert.rejects(adapter.execute(req("desktop press key",{key:"A+B+C+D+E"})),/Unsupported keyboard key/);
  assert.equal((await adapter.execute(req("desktop scroll",{amount:-50})) as any).amount,-20,"scroll is bounded");
  const shot=await adapter.execute(req("desktop screenshot",{})) as any;
  assert.equal(shot.mimeType,"image/jpeg");assert.equal(shot.screen,"2560x1440");
  assert.equal(Buffer.from(shot.base64,"base64").toString(),"jpeg-bytes");
}finally{Object.defineProperty(process,"platform",real);}
console.log("desktop-windows: all assertions passed");
