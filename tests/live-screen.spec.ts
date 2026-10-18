import {LiveScreenObserver} from "../src/desktop/live-screen.js";
import type {ToolAdapter} from "../src/tools/executor.js";

function adapter(frames:string[]):ToolAdapter{
 let index=0;
 return {async execute(){const base64=frames[Math.min(index++,frames.length-1)]!;return{data:{mimeType:"image/png",base64,bytes:Buffer.from(base64,"base64").length}};}};
}

const frame=Buffer.from("png-test").toString("base64");
const observer=new LiveScreenObserver({adapter:adapter([frame]),intervalMs:100});
const first=await observer.captureNow();
if(first.sequence!==1||first.mimeType!=="image/png"||first.base64!==frame)throw new Error("Live screen capture failed.");
if(observer.isRunning())throw new Error("Observer should start stopped.");
observer.start();
await new Promise(resolve=>setTimeout(resolve,150));
if(!observer.isRunning())throw new Error("Observer did not start.");
if(!observer.latest()?.base64)throw new Error("Observer did not retain a frame.");
observer.stop();
if(observer.isRunning())throw new Error("Observer did not stop.");

// The runtime passes the registered desktop.screenshot adapter directly, so the
// actual adapter result is the frame itself rather than {data: frame}.
const directObserver=new LiveScreenObserver({adapter:{async execute(){
 return {mimeType:"image/jpeg",base64:frame,bytes:Buffer.from(frame,"base64").length};
}}});
const directFrame=await directObserver.captureNow();
if(directFrame.mimeType!=="image/jpeg"||directFrame.base64!==frame||directFrame.bytes!==Buffer.from(frame,"base64").length){
 throw new Error("Live screen did not accept the raw desktop adapter frame.");
}

// Also retain compatibility with ToolExecutor's {ok, data} result envelope.
const envelopedObserver=new LiveScreenObserver({adapter:{async execute(){
 return {ok:true,data:{mimeType:"image/png",base64:frame,bytes:Buffer.from(frame,"base64").length}};
}}});
const envelopedFrame=await envelopedObserver.captureNow();
if(envelopedFrame.mimeType!=="image/png"||envelopedFrame.base64!==frame){
 throw new Error("Live screen did not accept the ToolExecutor result envelope.");
}

let releaseCapture:((value:{data:{mimeType:string;base64:string;bytes:number}})=>void)|undefined;
let slowCalls=0;
const slowObserver=new LiveScreenObserver({intervalMs:100,adapter:{async execute(){
 slowCalls++;
 return await new Promise<{data:{mimeType:string;base64:string;bytes:number}}>(resolve=>{releaseCapture=resolve;});
}}});
const captureA=slowObserver.captureNow();
const captureB=slowObserver.captureNow();
if(slowCalls!==1)throw new Error("Concurrent live-frame requests were not coalesced.");
releaseCapture?.({data:{mimeType:"image/png",base64:frame,bytes:Buffer.from(frame,"base64").length}});
await Promise.all([captureA,captureB]);
if(slowCalls!==1)throw new Error("More than one screenshot was captured for overlapping requests.");

const failingObserver=new LiveScreenObserver({adapter:{async execute(){throw new Error("simulated desktop capture denied");}}});
await failingObserver.captureNow().then(()=>{throw new Error("failed desktop capture was accepted");}).catch(error=>{
 if(!String(error).includes("simulated desktop capture denied"))throw error;
});
if(failingObserver.lastErrorMessage()!=="simulated desktop capture denied")throw new Error("Live screen did not preserve the capture error.");

const rejectedObserver=new LiveScreenObserver({adapter:{async execute(){return {ok:false,error:"simulated nested adapter failure"};}}});
await rejectedObserver.captureNow().then(()=>{throw new Error("rejected adapter result was accepted");}).catch(error=>{
 if(!String(error).includes("simulated nested adapter failure"))throw error;
});

console.log("live screen observer accepts raw/enveloped frames, coalesces captures and preserves diagnostics");
