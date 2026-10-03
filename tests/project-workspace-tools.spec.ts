import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {registerToolFabric} from "../src/tools/builtin.js";
import {createProjectBootstrapToolAdapter} from "../src/tools/fabric.js";
import type {ToolRequest} from "../src/core/types.js";

describe("project workspace tools",()=>{
  it("registers verification and bootstrap without duplicate tool names",async()=>{
    const root=await mkdtemp(join(tmpdir(),"layanx-workspace-"));
    try{
      const core=new LayanXCore();
      registerToolFabric(core,{workspaceRoot:root});
      const names=core.tools.list().map(tool=>tool.name);
      expect(names).toContain("project.verify");
      expect(names).toContain("project.bootstrap");
      expect(new Set(names).size).toBe(names.length);
      expect(core.toolAdapters.has("project.verify")).toBe(true);
      expect(core.toolAdapters.has("project.bootstrap")).toBe(true);
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
      expect(result.passed).toBe(true);
      expect(result.initialized).toBe(true);
      const packageJson=JSON.parse(await readFile(join(root,"demo","package.json"),"utf8")) as {name?:string};
      expect(packageJson.name).toBe("demo");
      await expect(adapter.execute({...base,idempotencyKey:"unsafe",payload:{dependencies:["https://example.com/pkg"]}}))
        .rejects.toThrow("Invalid npm package name");
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
