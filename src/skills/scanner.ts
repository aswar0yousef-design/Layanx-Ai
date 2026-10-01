import type {SkillManifest} from "./registry.js";
export interface ScanFinding{severity:"info"|"low"|"medium"|"high"|"critical";code:string;message:string;}
export interface ScanResult{safe:boolean;findings:ScanFinding[];}
export class SkillScanner{
 scan(skill:SkillManifest):ScanResult{
  const findings:ScanFinding[]=[];
  if(!skill.checksum)findings.push({severity:"critical",code:"MISSING_CHECKSUM",message:"Skill has no integrity checksum."});
  if(!skill.license)findings.push({severity:"medium",code:"UNKNOWN_LICENSE",message:"Skill license is unknown."});
  if(skill.permissions.includes("L5_CRITICAL"))findings.push({severity:"high",code:"CRITICAL_PERMISSION",message:"Skill requests critical permission."});
  if(skill.networkHosts.includes("*"))findings.push({severity:"high",code:"OPEN_NETWORK",message:"Skill requests unrestricted network access."});
  return{safe:!findings.some(f=>f.severity==="high"||f.severity==="critical"),findings};
 }
}
