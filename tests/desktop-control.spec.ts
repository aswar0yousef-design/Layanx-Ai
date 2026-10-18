import {strict as assert} from "node:assert";
import {createDesktopControlToolAdapter,parseWindowTitleMatch} from "../src/tools/desktop-control.js";
import type {ToolRequest} from "../src/core/types.js";

const calls:Array<{command:string;args:string[]}>=[];
const adapter=createDesktopControlToolAdapter({runner:async(command,args)=>{calls.push({command,args});if(args.includes("shot"))return{stdout:Buffer.from("fake-png").toString("base64"),stderr:"",code:0};return{stdout:"ok",stderr:"",code:0};}});
const base:ToolRequest={missionId:"m",agentId:"core",projectId:"p",tool:"desktop.mouse.move",action:"desktop move mouse",permission:"L4_EXECUTE",idempotencyKey:"desktop-1",payload:{x:100,y:200}};
const moved=await adapter.execute(base) as {x:number;y:number};
assert.equal(moved.x,100);assert.equal(moved.y,200);
assert.equal(calls.length,1);

await adapter.execute({...base,tool:"desktop.keyboard.type",action:"desktop type",idempotencyKey:"desktop-2",payload:{text:"LayanX"}});
await adapter.execute({...base,tool:"desktop.keyboard.press",action:"desktop press key",idempotencyKey:"desktop-3",payload:{key:"ENTER"}});
assert.equal(calls.length,3);

await adapter.execute({...base,tool:"desktop.keyboard.type",action:"desktop type",idempotencyKey:"desktop-4",payload:{text:"x".repeat(4000)}});
await adapter.execute({...base,tool:"desktop.screenshot",action:"desktop screenshot",permission:"L2_ANALYZE",idempotencyKey:"desktop-5",payload:{}});
await adapter.execute({...base,tool:"desktop.keyboard.press",action:"desktop press key",idempotencyKey:"desktop-6",payload:{key:"NOPE"}}).then(()=>{throw new Error("unsupported key accepted");}).catch(e=>assert.match(String(e),/Unsupported keyboard key/));
await adapter.execute({...base,tool:"desktop.mouse.move",action:"desktop move mouse",idempotencyKey:"desktop-7",payload:{x:20001,y:0}}).then(()=>{throw new Error("out-of-range coordinate accepted");}).catch(e=>assert.match(String(e),/between 0 and 20000/));

const matchingWindow=parseWindowTitleMatch(JSON.stringify({windows:[
 {title:"Calculator",pid:111},
 {title:"Untitled - Notepad",pid:222}
]}),"Notepad");
assert.deepEqual(matchingWindow,{exists:true,title:"Untitled - Notepad",pid:222,windowsScanned:2});
const missingWindow=parseWindowTitleMatch(JSON.stringify({windows:[{title:"Calculator",pid:111}]}),"Notepad");
assert.deepEqual(missingWindow,{exists:false,title:"Notepad",pid:null,windowsScanned:1});
await Promise.resolve().then(()=>parseWindowTitleMatch("not json","Notepad")).then(()=>{throw new Error("invalid window-list JSON accepted");}).catch(e=>assert.match(String(e),/unreadable window list/));

console.log("Desktop control adapter and read-only window-detection tests passed.");