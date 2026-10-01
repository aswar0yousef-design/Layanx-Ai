import type {SkillManifest} from "./registry.js";
import {SkillRegistry} from "./registry.js";
import {SkillScanner} from "./scanner.js";

export interface SkillPackage{manifest:SkillManifest;files:string[];}
export class SkillPipeline{
 constructor(private readonly registry:SkillRegistry,private readonly scanner:SkillScanner){}
 inspect(pkg:SkillPackage){return this.scanner.scan(pkg.manifest);}
 install(pkg:SkillPackage){
  const scan=this.inspect(pkg);
  if(!scan.safe)throw new Error("Skill rejected by security scan.");
  this.registry.register({...pkg.manifest,status:"quarantined"});
  return this.registry.get(pkg.manifest.id);
 }
 approveAndEnable(id:string){this.registry.approve(id);this.registry.enable(id);return this.registry.get(id);}
}
