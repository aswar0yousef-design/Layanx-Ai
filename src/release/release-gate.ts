export interface ReleaseEvidence{typecheck:boolean;tests:boolean;redTeam:boolean;configuration:boolean;recovery:boolean;version:string;commitSha:string;checksum:string;}
export interface ReleaseDecision{allowed:boolean;reasons:string[];}
export class ReleaseGate{
 evaluate(e:ReleaseEvidence):ReleaseDecision{
  const reasons:string[]=[];
  for(const [name,ok] of Object.entries({typecheck:e.typecheck,tests:e.tests,redTeam:e.redTeam,configuration:e.configuration,recovery:e.recovery}))if(!ok)reasons.push(name+" gate failed.");
  if(!e.version.trim())reasons.push("Version is required.");
  if(!e.commitSha.trim())reasons.push("Commit SHA is required.");
  if(!e.checksum.trim())reasons.push("Release checksum is required.");
  return{allowed:reasons.length===0,reasons};
 }
}
