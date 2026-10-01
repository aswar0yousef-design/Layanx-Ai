export type RecoveryAuditResult="started"|"rolled_back"|"verified"|"halted";

export interface RecoveryAuditEvent{
 timestamp:string;
 actor:string;
 action:"recovery.started"|"recovery.rollback"|"recovery.verified"|"recovery.halted";
 resource:string;
 result:RecoveryAuditResult;
 metadata:{
  reason?:string;
  fromVersion?:string;
  toVersion?:string;
  fromCommitSha?:string;
  toCommitSha?:string;
  fromChecksum?:string;
  toChecksum?:string;
  verificationReason?:string;
 };
}

export interface RecoveryAuditSummary{
 resource:string;
 started?:RecoveryAuditEvent;
 rollback?:RecoveryAuditEvent;
 verified?:RecoveryAuditEvent;
 halted?:RecoveryAuditEvent;
 complete:boolean;
}

export class RecoveryAuditTrail{
 private readonly events:RecoveryAuditEvent[]=[];

 record(event:RecoveryAuditEvent):void{
  this.events.push({
   ...event,
   metadata:{...event.metadata}
  });
 }

 list(resource?:string):RecoveryAuditEvent[]{
  const events=resource?this.events.filter(event=>event.resource===resource):this.events;
  return events.map(event=>({...event,metadata:{...event.metadata}}));
 }

 summarize(resource:string):RecoveryAuditSummary{
  const events=this.list(resource);
  return{
   resource,
   started:events.find(event=>event.action==="recovery.started"),
   rollback:events.find(event=>event.action==="recovery.rollback"),
   verified:events.find(event=>event.action==="recovery.verified"),
   halted:events.find(event=>event.action==="recovery.halted"),
   complete:events.some(event=>event.action==="recovery.verified")&&
    !events.some(event=>event.action==="recovery.halted")
  };
 }
}
