import {LiveScreenObserver} from "../src/desktop/live-screen.js";
import type {ToolAdapter} from "../src/tools/executor.js";

function adapter(frames:string[]):ToolAdapter{
 let index=0;
 return {async execute(){const base64=frames[Math.min(index++,frames.length-1)]!;return{data:{mimeType:"image/png",base64,bytes:base64.length}};}};
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
console.log("live screen observer ok");
