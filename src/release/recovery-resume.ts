import type {Deployment, RecoveryDecision} from "./rollback.js";
import {RecoveryStateMachine} from "./recovery-state-machine.js";
import type {PersistedRecoveryRecord} from "./recovery-persistence.js";

export type RecoveryResumeAction="check"|"execute_rollback"|"verify"|"complete"|"halt";

export interface RecoveryResumePlan{
 recoveryId:string;
 state:PersistedRecoveryRecord["state"];
 action:RecoveryResumeAction;
 reason:string;
 target?:Deployment;
}

export class RecoveryResumeEngine{
 plan(record:PersistedRecoveryRecord):RecoveryResumePlan{
  const target=this.target(record);
  switch(record.state){
   case "checking":
    return{recoveryId:record.recoveryId,state:record.state,action:"check",reason:"Recovery was interrupted during health checking."};
   case "recovering":
    return{recoveryId:record.recoveryId,state:record.state,action:"check",reason:"Recovery may have executed before the process stopped; verify deployment before another rollback.",...(target?{target}:{})};
   case "rolled_back":
    return{recoveryId:record.recoveryId,state:record.state,action:"verify",reason:"Rollback was recorded; verify the target deployment before continuing.",...(target?{target}:{})};
   case "verifying":
    return{recoveryId:record.recoveryId,state:record.state,action:"verify",reason:"Recovery was interrupted during post-rollback verification.",...(target?{target}:{})};
   case "verified":
    return{recoveryId:record.recoveryId,state:record.state,action:"complete",reason:"Recovery was already verified.",...(target?{target}:{})};
   case "halted":
    return{recoveryId:record.recoveryId,state:record.state,action:"halt",reason:"Recovery was halted and must not resume automatically.",...(target?{target}:{})};
   case "idle":
    return{recoveryId:record.recoveryId,state:record.state,action:"check",reason:"Recovery has not started its first health check."};
  }
 }

 transitionForAction(machine:RecoveryStateMachine,action:RecoveryResumeAction):void{
  const next:Record<RecoveryResumeAction,Parameters<RecoveryStateMachine["transition"]>[0]|undefined>={
   check:"checking",
   execute_rollback:"recovering",
   verify:"verifying",
   complete:"verified",
   halt:"halted"
  };
  const state=next[action];
  if(state)machine.transition(state);
 }

 private target(record:PersistedRecoveryRecord):Deployment|undefined{
  if(!record.targetVersion||!record.targetCommitSha||!record.targetChecksum)return undefined;
  return{
   version:record.targetVersion,
   commitSha:record.targetCommitSha,
   manifestChecksum:record.targetChecksum,
   deployedAt:record.updatedAt
  };
 }
}
