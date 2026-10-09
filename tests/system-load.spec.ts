import assert from "node:assert/strict";
import http from "node:http";
import type {AddressInfo} from "node:net";
import {cpuPercentBetween,parseNvidiaSmi,systemLoad} from "../src/platform/system-load.js";

// The dashboard shows how busy the PC is: CPU, RAM, the NVIDIA GPU and the models Ollama has loaded.
assert.deepEqual(parseNvidiaSmi("NVIDIA GeForce GTX 1660 SUPER, 37, 4211, 6144\r\n"),{name:"NVIDIA GeForce GTX 1660 SUPER",percent:37,memoryUsedMB:4211,memoryTotalMB:6144});
assert.equal(parseNvidiaSmi(""),null);
assert.equal(parseNvidiaSmi("NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver."),null,"driver errors are not a GPU");
assert.equal(parseNvidiaSmi("GPU, [N/A], [N/A], 6144"),null);
assert.equal(cpuPercentBetween({idle:100,total:200,at:0},{idle:150,total:400,at:1}),75);
assert.equal(cpuPercentBetween({idle:100,total:200,at:0},{idle:100,total:200,at:1}),0,"no time passed");

const ollama=http.createServer((req,res)=>{
  if(req.url==="/api/ps"){res.writeHead(200,{"content-type":"application/json"});res.end(JSON.stringify({models:[{name:"qwen3.5:9b",model:"qwen3.5:9b",size:7_000_000_000,size_vram:5_600_000_000,expires_at:"2026-10-09T20:00:00Z"},{name:"bge-m3:latest",size:1_200_000_000,size_vram:1_200_000_000}]}));return;}
  res.writeHead(404);res.end();
});
await new Promise<void>(r=>ollama.listen(0,"127.0.0.1",()=>r()));
const base=`http://127.0.0.1:${(ollama.address() as AddressInfo).port}`;
const load=await systemLoad({OLLAMA_BASE_URL:base});
assert.ok(load.cpu.cores>0&&load.cpu.percent>=0&&load.cpu.percent<=100);
assert.ok(load.memory.totalBytes>0&&load.memory.usedBytes>0&&load.memory.percent>0&&load.memory.percent<=100);
assert.equal(load.ollama,true);
assert.deepEqual(load.models.map(m=>[m.name,m.vramBytes]),[["qwen3.5:9b",5_600_000_000],["bge-m3:latest",1_200_000_000]]);
assert.ok(load.gpu===null||load.gpu.memoryTotalMB>0,"no NVIDIA card here: null");
ollama.close();
const off=await systemLoad({OLLAMA_BASE_URL:"http://127.0.0.1:9"});
assert.equal(off.ollama,false);assert.deepEqual(off.models,[]);
console.log("system-load: CPU share between samples, RAM, nvidia-smi parsing and Ollama's loaded models");
process.exit(0);
