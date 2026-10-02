import type {Mission,PermissionLevel} from "./types.js";
import type {RuntimeResult} from "./runtime.js";

export interface RepairAttempt{
  attempt:number;
  tool?:string;
  action?:string;
  ok:boolean;
  error?:string;
  data?:unknown;
}

export interface RepairLoopResult{
  missionId:string;
  completed:boolean;
  attempts:number;
  repaired:boolean;
  exhausted:boolean;
  blocked:boolean;
  results:RepairAttempt[];
  reason?:string;
}

export interface RepairLoopPolicy{
  maxAttempts:number;
  allowedPermissions:PermissionLevel[];
}

export class AutonomousRepairLoop{
  readonly defaultPolicy:RepairLoopPolicy={
    maxAttempts:3,
    allowedPermissions:["L1_READ","L2_ANALYZE","L3_MODIFY","L4_EXECUTE"]
  };

  normalizeAttempts(value:number|undefined):number{
    if(!Number.isFinite(value??NaN))return this.defaultPolicy.maxAttempts;
    return Math.min(Math.max(Math.floor(value as number),1),5);
  }

  isRepairCandidate(result:RuntimeResult):boolean{
    return result.ok===false&&result.recoverable!==false;
  }

  isSafeRepairPermission(permission:PermissionLevel):boolean{
    return this.defaultPolicy.allowedPermissions.includes(permission);
  }
}
