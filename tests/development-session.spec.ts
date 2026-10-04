import {mkdtemp,rm,mkdir,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {LayanXCore} from "../src/core/orchestrator.js";
import {registerBuiltinTools,registerToolFabric} from "../src/tools/builtin.js";
const root=await mkdtemp(join(process.cwd(),"dev-session-test-"));
process.env.LAYANX_WORKSPACE_ROOT=root;
await mkdir(join(root,"p"),{recursive:true});
await writeFile(join(root,"p","package.json"),JSON.stringify({scripts:{test:"echo test",typecheck:"echo typecheck"}}),"utf8");
const core=new LayanXCore();
registerBuiltinTools(core); registerToolFabric(core,{workspaceRoot:root});
const definition=core.tools.get("development.prepare");
if(definition.permission!=="L2_ANALYZE"||definition.dangerous)throw new Error("Development preparation must remain analysis-only.");
const result=await core.toolAdapters.get("development.prepare").execute({
 missionId:"m",agentId:"core",projectId:"p",tool:"development.prepare",action:"prepare development session",
 permission:"L2_ANALYZE",idempotencyKey:"dev-session-test",payload:{}
}) as {verification:{available:string[];requiresApproval:boolean};dangerousActions:Record<string,string>};
if(!result.verification.available.includes("test")||!result.verification.requiresApproval)throw new Error("Verification plan is incomplete.");
if(result.dangerousActions.branch!=="git.branch"||result.dangerousActions.rollback!=="git.rollback")throw new Error("Dangerous action map is incomplete.");
await rm(root,{recursive:true,force:true});
console.log("Development session safety test passed.");
