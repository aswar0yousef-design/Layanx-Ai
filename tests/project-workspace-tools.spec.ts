import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {strict as assert} from "node:assert";
import {LayanXCore} from "../src/core/orchestrator.js";
import {registerToolFabric} from "../src/tools/builtin.js";
import {createProjectBootstrapToolAdapter} from "../src/tools/fabric.js";
import type {ToolRequest} from "../src/core/types.js";

const tests:Promise<void>[]=[];
const it=(name:string,fn:()=>Promise<void>)=>{tests.push(fn().catch(error=>{throw new Error(name+": "+String(error));}));};

  it("registers verification and bootstrap without duplicate tool names",async()=>{
    const root=await mkdtemp(join(tmpdir(),"layanx-workspace-"));
    try{
      const core=new LayanXCore();
      registerToolFabric(core,{workspaceRoot:root});
      const names=core.tools.list().map(tool=>tool.name);
      assert.ok(names.includes("project.verify"));
      assert.ok(names.includes("project.bootstrap"));
      assert.equal(new Set(names).size,names.length);
      assert.equal(core.toolAdapters.has("project.verify"),true);
      assert.equal(core.toolAdapters.has("project.bootstrap"),true);
    }finally{await rm(root,{recursive:true,force:true});}
  });

  it("initializes an isolated npm workspace and blocks unsafe package specs",async()=>{
    const root=await mkdtemp(join(tmpdir(),"layanx-workspace-"));
    try{
      const adapter=createProjectBootstrapToolAdapter({root});
      const base:ToolRequest={
        missionId:"m",agentId:"core",projectId:"demo",tool:"project.bootstrap",
        action:"bootstrap project",permission:"L4_EXECUTE",idempotencyKey:"bootstrap-1",
        payload:{dependencies:[],devDependencies:[]}
      };
      const result=await adapter.execute(base) as {passed:boolean;initialized:boolean};
      assert.equal(result.passed,true);
      assert.equal(result.initialized,true);
      const packageJson=JSON.parse(await readFile(join(root,"demo","package.json"),"utf8")) as {name?:string};
      assert.equal(packageJson.name,"demo");
      await assert.rejects(()=>adapter.execute({...base,idempotencyKey:"unsafe",payload:{dependencies:["https://example.com/pkg"]}}),/Invalid npm package name/);
    }finally{await rm(root,{recursive:true,force:true});}
  });
await Promise.all(tests);
console.log("Project workspace tools tests passed.");
