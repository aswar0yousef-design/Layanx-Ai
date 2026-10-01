export interface LedgerEntry{id:string;missionId:string;agentId:string;action:string;status:"started"|"completed"|"failed"|"blocked";timestamp:string;detail?:string;}
export class AgentLedger{
 private readonly entries:LedgerEntry[]=[];
 append(entry:LedgerEntry):void{this.entries.push({...entry});}
 restore(entries:LedgerEntry[]):void{const existing=new Set(this.entries.map(e=>e.id));for(const entry of entries)if(!existing.has(entry.id))this.entries.push(structuredClone(entry));}
 forMission(missionId:string):LedgerEntry[]{return this.entries.filter(e=>e.missionId===missionId).map(e=>structuredClone(e));}
 all():LedgerEntry[]{return this.entries.map(e=>structuredClone(e));}
}
