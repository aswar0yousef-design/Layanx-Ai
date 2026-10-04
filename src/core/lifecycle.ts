import type {Mission,MissionStatus} from "./types.js";
import type {ExecutionStateStore} from "./execution-state.js";

export type RuntimeLifecycleStatus=Exclude<MissionStatus,"planned">;

const EXECUTION_FOR:Record<RuntimeLifecycleStatus,"running"|"completed"|"blocked"|"failed">={
 running:"running",
 verifying:"running",
 completed:"completed",
 failed:"failed",
 blocked:"blocked",
 cancelled:"blocked"
};

export function setLifecycle(
 mission:Mission,
 executionStates:ExecutionStateStore,
 status:RuntimeLifecycleStatus,
 recoverable?:boolean
){
 mission.status=status;
 const defaultRecoverable=status==="running"||status==="verifying"||status==="failed";
 executionStates.update(mission.id,{
  status:EXECUTION_FOR[status],
  recoverable:recoverable??defaultRecoverable
 });
 return{mission,execution:executionStates.get(mission.id)!};
}
