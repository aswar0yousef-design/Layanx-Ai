import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolRequest} from "../core/types.js";
import type {ToolAdapter} from "./executor.js";
import {createHttpReadAdapter} from "./http-read.js";
import {createGitHubReadAdapter} from "../connectors/github-read.js";
import {createGitToolAdapter} from "./git.js";
import {createBrowserToolAdapter,createFileToolAdapter,createFileWriteToolAdapter,createTerminalToolAdapter} from "./fabric.js";

function payloadRecord(request:ToolRequest):Record<string,unknown>{
  return request.payload&&typeof request.payload==="object"&&!Array.isArray(request.payload)
    ? request.payload as Record<string,unknown> : {};
}

export function registerBuiltinTools(core:LayanXCore):void {
  core.tools.register({
    name:"runtime.status",
    description:"read runtime status, configured providers, and registered models",
    permission:"L1_READ",
    dangerous:false,
    actions:["read runtime status","inspect runtime","runtime status","قراءة حالة النظام","فحص التشغيل"],
    tags:["runtime","status","health","diagnostics","تشغيل","حالة","حالة النظام"]
  });
  core.toolAdapters.register("runtime.status",{
    async execute():Promise<unknown>{
      return {
        system:"LayanX AI",
        ready:core.isReady(),
        agents:core.agents.list().map(agent=>agent.agentId),
        providers:core.providers.list().map(provider=>provider.name),
        models:core.models.list().map(model=>({
          id:model.id,provider:model.provider,local:model.local,enabled:model.enabled,priority:model.priority
        })),
        tools:core.tools.list().map(tool=>({
          name:tool.name,permission:tool.permission,dangerous:tool.dangerous
        }))
      };
    }
  } satisfies ToolAdapter);

  core.tools.register({
    name:"mission.inspect",
    description:"read the current mission status, goal, and execution steps",
    permission:"L1_READ",
    dangerous:false,
    actions:["inspect mission","read mission","mission status","فحص المهمة","قراءة المهمة"],
    tags:["mission","inspect","status","progress","مهمة","فحص","حالة المهمة"]
  });
  core.toolAdapters.register("mission.inspect",{
    async execute(request:ToolRequest):Promise<unknown>{
      const mission=core.missions.get(request.missionId);
      if(!mission)throw new Error("Mission not found.");
      return {
        id:mission.id,
        goal:mission.goal,
        status:mission.status,
        risk:mission.risk,
        requiredPermission:mission.requiredPermission,
        steps:mission.steps.map(step=>({id:step.id,description:step.description,status:step.status}))
      };
    }
  } satisfies ToolAdapter);

  core.tools.register({
    name:"memory.recall",
    description:"read relevant non-sensitive mission memory by query",
    permission:"L1_READ",
    dangerous:false,
    actions:["recall memory","search memory","read memory","استرجاع الذاكرة","بحث في الذاكرة","قراءة الذاكرة"],
    tags:["memory","recall","search","context","ذاكرة","استرجاع","بحث","سياق"]
  });
  core.toolAdapters.register("memory.recall",{
    async execute(request:ToolRequest):Promise<unknown>{
      const input=payloadRecord(request);
      const query=typeof input.query==="string"?input.query.trim():request.action;
      const limit=typeof input.limit==="number"&&Number.isInteger(input.limit)
        ?Math.min(Math.max(input.limit,1),20):10;
      if(!query)throw new Error("Memory query is required.");
      return {query,entries:core.memory.recall(query,limit)};
    }
  } satisfies ToolAdapter);
}



  core.tools.register({
    name:"project.inspect",
    description:"build a bounded static inventory of the current project workspace without executing project code",
    permission:"L2_ANALYZE",
    dangerous:false,
    actions:["inspect project","analyze project","project intelligence","فحص المشروع","تحليل المشروع","ذكاء المشروع"],
    tags:["project","intelligence","inventory","architecture","analysis","مشروع","تحليل"]
  });
  core.toolAdapters.register("project.inspect",{
    async execute(request:ToolRequest):Promise<unknown>{
      if(!request.projectId)throw new Error("Project identity is required.");
      return core.projectIntelligence.scan(request.projectId);
    }
  } satisfies ToolAdapter);

}


export function registerHttpReadTool(core:LayanXCore):void {
 core.tools.register({
  name:"http.read",
  description:"read a public HTTP or HTTPS resource with bounded response size and timeout",
  permission:"L1_READ",
  dangerous:false,
  actions:["read url","fetch url","read http","read https","قراءة رابط","جلب رابط"],
  tags:["http","https","url","web","read","رابط","ويب"]
 });
 core.toolAdapters.register("http.read",createHttpReadAdapter());
}


export function registerGitHubReadTools(core:LayanXCore,options:{token?:string;baseUrl?:string}={}):void {
 const adapter=createGitHubReadAdapter(options);
 const definitions=[
  {name:"github.repo.read",description:"read public GitHub repository metadata",action:"read repository",tags:["github","repository","repo","read","git"]},
  {name:"github.issues.list",description:"list open GitHub issues for a repository",action:"list issues",tags:["github","issues","issue","repository","read"]},
  {name:"github.prs.list",description:"list open GitHub pull requests for a repository",action:"list pull requests",tags:["github","pull","request","prs","repository","read"]}
 ];
 for(const definition of definitions){
  core.tools.register({name:definition.name,description:definition.description,permission:"L1_READ",dangerous:false,actions:[definition.action],tags:definition.tags});
  core.toolAdapters.register(definition.name,adapter);
 }
}


export function registerToolFabric(core:LayanXCore,options:{workspaceRoot?:string}={}):void {
 const workspaceRoot=options.workspaceRoot??process.env.LAYANX_WORKSPACE_ROOT??process.cwd();
 core.tools.register({
  name:"browser.read",
  description:"read a public HTTP or HTTPS web resource without browser-side execution",
  permission:"L1_READ",
  dangerous:false,
  actions:["browse url","read web page","read webpage","فتح صفحة","قراءة صفحة ويب"],
  tags:["browser","web","http","https","read","متصفح","ويب"]
 });
 core.toolAdapters.register("browser.read",createBrowserToolAdapter());

 for(const definition of [
  {name:"files.read",description:"read a file inside the configured project workspace",action:"read file",tags:["files","read","workspace","ملفات","قراءة"]},
  {name:"files.list",description:"list files inside the configured project workspace",action:"list files",tags:["files","list","workspace","ملفات","قائمة"]},
  {name:"files.stat",description:"inspect metadata for a file inside the configured project workspace",action:"stat file",tags:["files","stat","workspace","ملفات","معلومات"]}
 ]){
  core.tools.register({name:definition.name,description:definition.description,permission:"L1_READ",dangerous:false,actions:[definition.action],tags:definition.tags});
  core.toolAdapters.register(definition.name,createFileToolAdapter({root:workspaceRoot}));
 }

 core.tools.register({
  name:"terminal.exec",
  description:"run an explicitly allowlisted diagnostic or verification command inside the configured project workspace",
  permission:"L4_EXECUTE",
  dangerous:true,
  actions:["run terminal command","execute diagnostic command","تشغيل أمر طرفية","تنفيذ أمر فحص"],
  tags:["terminal","command","diagnostic","workspace","طرفية","أوامر"]
 });
 core.toolAdapters.register("terminal.exec",createTerminalToolAdapter({root:workspaceRoot}));

 core.tools.register({
  name:"files.write",
  description:"write or replace a UTF-8 file inside the configured project workspace",
  permission:"L3_MODIFY",
  dangerous:false,
  actions:["write file","modify file","كتابة ملف","تعديل ملف"],
  tags:["files","write","modify","workspace","ملفات","كتابة","تعديل"]
 });
 core.toolAdapters.register("files.write",createFileWriteToolAdapter({root:workspaceRoot}));

 for(const definition of [
  {name:"git.status",description:"inspect the current project Git status",action:"git status",permission:"L2_ANALYZE" as const,dangerous:false},
  {name:"git.diff",description:"inspect unstaged project changes",action:"git diff",permission:"L2_ANALYZE" as const,dangerous:false},
  {name:"git.log",description:"inspect recent project commits",action:"git log",permission:"L2_ANALYZE" as const,dangerous:false},
  {name:"git.add",description:"stage one explicit project path for a commit",action:"git add",permission:"L4_EXECUTE" as const,dangerous:true},
  {name:"git.commit",description:"create a Git commit in the project workspace",action:"git commit",permission:"L4_EXECUTE" as const,dangerous:true},
  {name:"git.push",description:"push the current project HEAD to an explicit remote branch",action:"git push",permission:"L4_EXECUTE" as const,dangerous:true}
 ]){
  core.tools.register({...definition,tags:["git","repository","project","version-control"]});
  core.toolAdapters.register(definition.name,createGitToolAdapter({root:workspaceRoot}));
 }
}
