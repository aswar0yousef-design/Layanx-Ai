import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolRequest} from "../core/types.js";
import type {ToolAdapter} from "./executor.js";
import {createHttpReadAdapter} from "./http-read.js";
import {createGitHubReadAdapter} from "../connectors/github-read.js";
import {createGitToolAdapter} from "./git.js";
import {createBrowserToolAdapter,createFileToolAdapter,createFileWriteToolAdapter,createTerminalToolAdapter,createProjectVerifyToolAdapter} from "./fabric.js";
import type {PaperTradingEngine} from "../trading/paper.js";
import type {StrategyRegistry} from "../trading/strategy.js";
import {backtest} from "../trading/backtest.js";
import {optimizeStrategy,walkForward,monteCarlo} from "../trading/evaluation.js";

function payloadRecord(request:ToolRequest):Record<string,unknown>{
  return request.payload&&typeof request.payload==="object"&&!Array.isArray(request.payload)
    ? request.payload as Record<string,unknown> : {};
}

export function registerTradingTools(core:LayanXCore,engine:PaperTradingEngine,strategies:StrategyRegistry):void {

 core.tools.register({name:"trading.strategy.list",description:"list registered trading strategies",permission:"L1_READ",dangerous:false,actions:["list trading strategies"],tags:["trading","strategy","research"]});
 core.toolAdapters.register("trading.strategy.list",{async execute(){return strategies.list().map(strategy=>({id:strategy.id,name:strategy.name,description:strategy.description,timeframe:strategy.timeframe}));}});
 core.tools.register({name:"trading.strategy.backtest",description:"backtest a registered trading strategy against supplied OHLCV candles",permission:"L2_ANALYZE",dangerous:false,actions:["backtest trading strategy"],tags:["trading","strategy","backtest","research"]});
 core.tools.register({name:"trading.strategy.optimize",description:"optimize a registered parameterized strategy on historical candles",permission:"L2_ANALYZE",dangerous:false,actions:["optimize trading strategy"],tags:["trading","strategy","optimization","research"]});
 core.tools.register({name:"trading.strategy.walk_forward",description:"run walk-forward evaluation using training optimization and out-of-sample windows",permission:"L2_ANALYZE",dangerous:false,actions:["walk forward trading strategy"],tags:["trading","strategy","walk-forward","research"]});
 core.tools.register({name:"trading.strategy.monte_carlo",description:"run Monte Carlo resampling over a completed trade series",permission:"L2_ANALYZE",dangerous:false,actions:["monte carlo trading strategy"],tags:["trading","strategy","monte-carlo","research"]});
 core.toolAdapters.register("trading.strategy.backtest",{async execute(request){const input=payloadRecord(request);if(typeof input.strategyId!=="string")throw new Error("strategyId is required.");if(!Array.isArray(input.candles))throw new Error("candles array is required.");const candles=input.candles as any[];return backtest(strategies.get(input.strategyId),candles as any,typeof input.startingEquity==="number"?input.startingEquity:100000,typeof input.riskFraction==="number"?input.riskFraction:0.005);}});
 core.toolAdapters.register("trading.strategy.optimize",{async execute(request){const input=payloadRecord(request);if(typeof input.strategyId!=="string"||!Array.isArray(input.candles))throw new Error("strategyId and candles are required.");const base=strategies.get(input.strategyId);if(!base.withParameters)throw new Error("Strategy does not expose optimization parameters.");const grid=payloadRecord({payload:input.grid}).constructor===Object&&input.grid&&typeof input.grid==="object"?input.grid as Record<string,number[]>:{};return optimizeStrategy(input.candles as any[],p=>base.withParameters!(p),grid,typeof input.startingEquity==="number"?input.startingEquity:100000,typeof input.riskFraction==="number"?input.riskFraction:.002).slice(0,20);}});
 core.toolAdapters.register("trading.strategy.walk_forward",{async execute(request){const input=payloadRecord(request);if(typeof input.strategyId!=="string"||!Array.isArray(input.candles))throw new Error("strategyId and candles are required.");const base=strategies.get(input.strategyId);if(!base.withParameters)throw new Error("Strategy does not expose optimization parameters.");return walkForward(input.candles as any[],p=>base.withParameters!(p),input.grid as Record<string,number[]>,Number(input.trainBars),Number(input.testBars),typeof input.startingEquity==="number"?input.startingEquity:100000,typeof input.riskFraction==="number"?input.riskFraction:.002);}});
 core.toolAdapters.register("trading.strategy.monte_carlo",{async execute(request){const input=payloadRecord(request);if(!Array.isArray(input.trades))throw new Error("trades are required.");return monteCarlo(input.trades as {pnl:number}[],typeof input.runs==="number"?input.runs:1000);}});
 const tools=[
  {name:"trading.account",description:"read the paper trading account and open positions",permission:"L1_READ" as const,dangerous:false,action:"read trading account",tags:["trading","account","paper"]},
  {name:"trading.quote",description:"read a configured paper trading quote",permission:"L1_READ" as const,dangerous:false,action:"read market quote",tags:["trading","quote","market","paper"]},
  {name:"trading.order.place",description:"place a paper market buy or sell order",permission:"L4_EXECUTE" as const,dangerous:true,action:"place paper trading order",tags:["trading","order","execute","paper"]},
  {name:"trading.position.close",description:"close an existing paper trading position",permission:"L4_EXECUTE" as const,dangerous:true,action:"close paper trading position",tags:["trading","position","execute","paper"]}
 ];
 for(const definition of tools){
  core.tools.register({...definition,actions:[definition.action]});
  core.toolAdapters.register(definition.name,{async execute(request){
   const input=payloadRecord(request);
   if(definition.name==="trading.account")return{account:engine.accountSnapshot(),positions:engine.positions()};
   if(definition.name==="trading.quote"){if(typeof input.symbol!=="string")throw new Error("symbol is required.");return engine.quote(input.symbol);}
   if(definition.name==="trading.order.place"){const symbol=typeof input.symbol==="string"?input.symbol:"";const side=input.side==="sell"?"sell":"buy";const quantity=typeof input.quantity==="number"?input.quantity:NaN;const stopLoss=typeof input.stopLoss==="number"?input.stopLoss:undefined;const takeProfit=typeof input.takeProfit==="number"?input.takeProfit:undefined;return engine.placeMarket({symbol,side,quantity,stopLoss,takeProfit});}
   if(typeof input.orderId!=="string")throw new Error("orderId is required.");
   const price=typeof input.price==="number"?input.price:undefined;return engine.closePosition(input.orderId,price);
  }});
 }
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

  core.tools.register({
    name:"development.prepare",
    description:"prepare a bounded development session with project state and explicit approval requirements",
    permission:"L2_ANALYZE",
    dangerous:false,
    actions:["prepare development session","plan development session","تحضير جلسة التطوير","خطة التطوير"],
    tags:["development","session","planning","verification","git"]
  });
  core.toolAdapters.register("development.prepare",{
    async execute(request:ToolRequest):Promise<unknown>{
      if(!request.projectId)throw new Error("Project identity is required.");
      const intelligence=await core.projectIntelligence.scan(request.projectId);
      return {
        projectId:request.projectId,
        project:{summary:intelligence.summary,markers:intelligence.markers,package:intelligence.package},
        verification:{supported:["test","typecheck","build"],available:intelligence.package?.scripts.filter(script=>["test","typecheck","build"].includes(script))??[],requiresApproval:true},
        dangerousActions:{branch:"git.branch",verify:"project.verify",rollback:"git.rollback",commit:"git.commit"},
        safety:"Preparation only; no dangerous action is executed."
      };
    }
  } satisfies ToolAdapter);

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
  {name:"git.checkpoint",description:"read the exact current Git commit for a rollback checkpoint",action:"git checkpoint",permission:"L2_ANALYZE" as const,dangerous:false},
  {name:"git.branch",description:"create an isolated non-protected repair branch",action:"git branch",permission:"L4_EXECUTE" as const,dangerous:true},
  {name:"git.diff",description:"inspect unstaged project changes",action:"git diff",permission:"L2_ANALYZE" as const,dangerous:false},
  {name:"git.log",description:"inspect recent project commits",action:"git log",permission:"L2_ANALYZE" as const,dangerous:false},
  {name:"git.add",description:"stage one explicit project path for a commit",action:"git add",permission:"L4_EXECUTE" as const,dangerous:true},
  {name:"git.commit",description:"create a Git commit in the project workspace",action:"git commit",permission:"L4_EXECUTE" as const,dangerous:true},
  {name:"git.rollback",description:"restore a non-protected project branch to an exact commit checkpoint",action:"git rollback",permission:"L4_EXECUTE" as const,dangerous:true},
  {name:"git.push",description:"push the current project HEAD to an explicit remote branch",action:"git push",permission:"L4_EXECUTE" as const,dangerous:true}
 ]){
  core.tools.register({...definition,tags:["git","repository","project","version-control"]});
  core.toolAdapters.register(definition.name,createGitToolAdapter({root:workspaceRoot}));
 }
}
