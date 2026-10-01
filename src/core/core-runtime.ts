import type {PermissionLevel,ToolRequest} from "./types.js";
import type {ToolAdapter} from "../tools/executor.js";
import {LayanXCore} from "./orchestrator.js";
import {MissionRunner} from "./mission-runner.js";
import {RuntimePersistence} from "./runtime-persistence.js";
import {RuntimeStorage} from "../storage/runtime-storage.js";
import {JsonStorageAdapter} from "../storage/json-adapter.js";
import {TransactionalIdempotencyStore} from "./transactional-idempotency.js";

export interface CoreRunResult{ok:boolean;missionId:string;verified:boolean;decision:string;error?:string;data?:unknown;}
const rank:Record<PermissionLevel,number>={L1_READ:1,L2_ANALYZE:2,L3_MODIFY:3,L4_EXECUTE:4,L5_CRITICAL:5};

export class CoreRuntime{
  private readonly runner:MissionRunner;
  constructor(private readonly core:LayanXCore,private readonly persistence?:RuntimePersistence){this.runner=new MissionRunner(core);}

  static withJsonPersistence(core:LayanXCore,path:string):CoreRuntime{
    return new CoreRuntime(core,new RuntimePersistence(RuntimeStorage.json(path)));
  }

  static withJsonStorage(path:string):CoreRuntime{
    const storageAdapter=new JsonStorageAdapter(path);
    const core=new LayanXCore(new TransactionalIdempotencyStore(storageAdapter));
    return new CoreRuntime(core,new RuntimePersistence(new RuntimeStorage(storageAdapter)));
  }

  async run(goal:string,request:Omit<ToolRequest,"missionId">,adapter:ToolAdapter,capabilityTokenId?:string,projectId="default",approvalId?:string):Promise<CoreRunResult>{
    const mission=this.core.startMission(goal);
    await this.persist(mission);
    let effectiveToken=capabilityTokenId;
    if(!effectiveToken&&rank[request.permission]===1){
      effectiveToken=this.core.capabilities.issue({missionId:mission.id,agentId:request.agentId,projectId,resource:request.tool,permission:"L1_READ",expiresAt:new Date(Date.now()+60000).toISOString()});
    }
    if(!effectiveToken){
      const result={ok:false,missionId:mission.id,verified:false,decision:"blocked",error:"A scoped capability token is required above L1_READ."} as CoreRunResult;
      await this.persist(mission);return result;
    }
    const gate=this.core.capabilities.authorize(effectiveToken,{missionId:mission.id,agentId:request.agentId,projectId,resource:request.tool,permission:request.permission});
    if(!gate.allowed){
      const result={ok:false,missionId:mission.id,verified:false,decision:"blocked",error:gate.reason} as CoreRunResult;
      await this.persist(mission);return result;
    }
    const risk=this.core.risk.assess({...request,missionId:mission.id});
    const decision=this.core.noAction.evaluate({risk:risk.level,hasRequiredApproval:Boolean(approvalId),budgetAvailable:true,goalRequiresAction:true});
    if(decision!=="execute"){
      this.core.capabilities.revoke(effectiveToken);
      const result={ok:false,missionId:mission.id,verified:false,decision,error:"Execution decision is "+decision} as CoreRunResult;
      await this.persist(mission);return result;
    }
    const result=await this.runner.execute(mission,{...request,missionId:mission.id},adapter,approvalId);
    this.core.capabilities.revoke(effectiveToken);
    await this.persist(mission);
    return{...result,decision};
  }

  async restorePersistedMission(missionId:string){return this.persistence?.get(missionId);}

  private async persist(mission:import("./types.js").Mission):Promise<void>{
    if(!this.persistence)return;
    const executionState=this.core.executionStates.get(mission.id);
    if(!executionState)return;
    await this.persistence.saveAtomic({
      mission,
      executionState,
      ledger:this.core.ledger.forMission(mission.id),
      audit:this.core.audit.forMission(mission.id),
      checkpoint:this.core.recovery.restore(mission.id),
      idempotency:await this.core.idempotency.list(),
      savedAt:new Date().toISOString(),
      schemaVersion:1
    });
  }
}
