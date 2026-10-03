import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {registerToolFabric} from "../src/tools/builtin.js";

describe("project workspace tools",()=>{
  it("registers project verification and bootstrap without duplicate tool names",async()=>{
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

  it("bootstraps an isolated npm project without accepting unsafe package specs",async()=>{
    const root=await mkdtemp(join(tmpdir(),"layanx-workspace-"));
    try{
      const core=new LayanXCore();
      registerToolFabric(core,{workspaceRoot:root});
      const mission=await core.planAndStartMission("bootstrap project", "demo");
      const result=await core.executeMissionTool(
        mission.id,"demo",0,
        {dependencies:[],devDependencies:[]}
      );
      expect(result.ok).toBe(true);
      expect(result.verified).toBe(true);
      const packageJson=JSON.parse(await readFile(join(root,"demo","package.json"),"utf8")) as {name?:string};
      expect(packageJson.name).toBe("demo");
      const adapter=core.toolAdapters.get("project.bootstrap");
      await expect(adapter.execute({
        missionId:mission.id,agentId:"core",tool:"project.bootstrap",action:"bootstrap project",
        permission:"L4_EXECUTE",idempotencyKey:"unsafe-package-test",payload:{dependencies:["https://example.com/pkg"]}
      })).rejects.toThrow("Invalid npm package name");
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
