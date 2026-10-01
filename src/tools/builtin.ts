import type {LayanXCore} from "../core/orchestrator.js";
import type {ToolRequest} from "../core/types.js";
import type {ToolAdapter} from "./executor.js";

function payloadRecord(request:ToolRequest):Record<string,unknown>{
  return request.payload&&typeof request.payload==="object"&&!Array.isArray(request.payload)
    ? request.payload as Record<string,unknown> : {};
}

export function registerBuiltinTools(core:LayanXCore):void {
  core.tools.register({
    name:"runtime.status",
    description:"read runtime status, configured providers, and registered models",
    permission:"L1_READ",
    dangerous:false
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
    dangerous:false
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
    dangerous:false
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
