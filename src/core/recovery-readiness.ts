export interface RecoveryReadiness{manifest:boolean;backup:boolean;checksum:boolean;lastKnownGood:boolean;ready:boolean;missing:string[];}
export class RecoveryReadinessCheck{
 evaluate(input:Omit<RecoveryReadiness,"ready"|"missing">):RecoveryReadiness{
  const missing:string[]=[];
  if(!input.manifest)missing.push("manifest");
  if(!input.backup)missing.push("backup");
  if(!input.checksum)missing.push("checksum");
  if(!input.lastKnownGood)missing.push("last-known-good");
  return{...input,ready:missing.length===0,missing};
 }
}
