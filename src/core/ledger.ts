export interface LedgerEntry {
  id:string;
  missionId:string;
  agentId:string;
  action:string;
  status:"started"|"completed"|"failed"|"blocked";
  timestamp:string;
  detail?:string;
}

export class AgentLedger {
  private readonly entries:LedgerEntry[]=[];
  append(entry:LedgerEntry):void{this.entries.push({...entry});}
  forMission(missionId:string):LedgerEntry[]{return this.entries.filter(e=>e.missionId===missionId);}
  all():LedgerEntry[]{return [...this.entries];}
}
