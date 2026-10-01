export interface ReleaseEvidence{security:boolean;typecheck:boolean;tests:boolean;redTeam:boolean;configuration:boolean;recovery:boolean;version:string;commitSha:string;checksum:string;}
export interface ReleaseDecision{allowed:boolean;reasons:string[];}

export class ReleaseGate{
 evaluate(e:ReleaseEvidence):ReleaseDecision{
  const reasons:string[]=[];
  for(const [name,ok] of Object.entries({
   security:e.security,
   typecheck:e.typecheck,
   tests:e.tests,
   redTeam:e.redTeam,
   configuration:e.configuration,
   recovery:e.recovery
  }))if(!ok)reasons.push(name+" gate failed.");
  if(!e.version.trim())reasons.push("Version is required.");
  if(!/^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(e.version.trim()))reasons.push("Version format is invalid.");
  if(!e.commitSha.trim())reasons.push("Commit SHA is required.");
  if(!/^[0-9a-f]{7,64}$/i.test(e.commitSha.trim()))reasons.push("Commit SHA format is invalid.");
  if(!/^[0-9a-f]{64}$/i.test(e.checksum.trim()))reasons.push("Release checksum format is invalid.");
  return{allowed:reasons.length===0,reasons};
 }
}
