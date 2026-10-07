import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import {closeBrowser,createBrowserTestAdapter} from "../src/autonomy/browser-test.js";

// Needs playwright-core plus Edge/Chrome (or LAYANX_BROWSER_PATH). Skips cleanly where neither exists.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lx-bt-"));process.env.LAYANX_WORKSPACE_ROOT=root;
let page='<!doctype html><html lang="ar"><head><meta name="viewport" content="width=device-width"><title>Shop</title></head><body><h1>المنتجات</h1><button id="buy">شراء</button><img src="/x.png"><div id="out"></div><script>document.getElementById("buy").onclick=()=>document.getElementById("out").textContent="تمت الإضافة"</script></body></html>';
const server=http.createServer((q,r)=>{if(q.url==="/x.png"){r.writeHead(404);r.end();return;}if(q.url==="/broken"){r.writeHead(200,{"content-type":"text/html"});r.end("<script>throw new Error('boom')</script>");return;}r.writeHead(200,{"content-type":"text/html; charset=utf-8"});r.end(page);});
await new Promise<void>(r=>server.listen(0,"127.0.0.1",()=>r()));
const base=`http://127.0.0.1:${(server.address() as any).port}`;
const tool=createBrowserTestAdapter();
const req=(payload:Record<string,unknown>)=>({missionId:"m",agentId:"core",projectId:"shop",tool:"browser.test",action:"test web page",permission:"L2_ANALYZE",idempotencyKey:"k",payload} as any);
try{
  let first:any;
  try{first=await tool.execute(req({url:base+"/",steps:[{action:"click",selector:"#buy"},{action:"expectText",text:"تمت الإضافة"}],baseline:"home"}));}
  catch(e){if(/playwright-core|browser could be started/i.test(String((e as Error).message))){console.log("autonomy-browser: skipped (no browser on this machine)");process.exit(0);}throw e;}
  assert.equal(first.results.length,2,"desktop and mobile");
  assert.ok(first.problems.some((p:string)=>/404/.test(p)),"missing image request is reported");
  assert.equal(first.results[0].accessibility.imagesWithoutAlt,1);
  assert.deepEqual(first.results[0].steps,["click #buy","expectText تمت الإضافة"]);
  assert.match(first.results[0].pageText,/button "شراء"/,"the page is readable as text (ARIA snapshot)");
  assert.match(first.results[0].pageText,/heading "المنتجات"/);
  assert.equal(first.results[1].pageText,undefined,"page text only for the first viewport");
  const flow=await tool.execute(req({url:base+"/",viewports:["desktop"],steps:[{action:"click",selector:"#buy"},{action:"snapshot"}]})) as any;
  assert.match(flow.results[0].snapshots[0],/تمت الإضافة/,"a snapshot step records the page mid-flow");
  assert.ok(first.results[0].baselineSaved);assert.ok(fs.existsSync(path.join(root,"shop",".layanx","baselines","home-desktop.jpg")));
  page=page.replace('<img src="/x.png">','');
  const same=await tool.execute(req({url:base+"/",baseline:"home"})) as any;
  assert.equal(typeof same.results[0].visualDiff,"number","diff is computed");assert.ok(same.results[0].visualDiff<0.02,"unchanged page matches its baseline");
  page=page.replace("<h1>المنتجات</h1>",'<h1 style="background:#c00;color:#fff;height:400px">المنتجات</h1>');
  const changed=await tool.execute(req({url:base+"/",baseline:"home",viewports:["desktop"]})) as any;
  assert.ok(changed.results[0].visualDiff>0.05&&changed.problems.some((p:string)=>/visual change/.test(p)),"a big visual change is caught");
  const broken=await tool.execute(req({url:base+"/broken",viewports:["desktop"]})) as any;
  assert.equal(broken.ok,false);assert.ok(broken.problems.some((p:string)=>/boom/.test(p)),"JavaScript errors are reported");
  await assert.rejects(tool.execute(req({url:"file:///etc/passwd"})),/Only http/);
  console.log("autonomy-browser: steps, errors, accessibility, screenshots and visual baselines verified");
}finally{server.close();await closeBrowser();}
process.exit(0);
