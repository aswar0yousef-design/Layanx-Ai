import type {CapabilityToken} from "./capability-token.js";
import {CapabilityTokenService} from "./capability-token.js";
import {CapabilityRegistry} from "./capability-registry.js";
export class CapabilityGate{
 constructor(private readonly service=new CapabilityTokenService(),private readonly registry=new CapabilityRegistry()){}
 issue(input:Omit<CapabilityToken,"id"|"issuedAt"|"nonce"){return this.registry.issue(this.service.issue(input));}
 authorize(tokenId:string,request:Parameters<CapabilityTokenService["validate"]>[1]){
  const token=this.registry.get(tokenId);
  if(!token||!this.registry.isActive(tokenId))return{allowed:false,reason:"Capability is missing, revoked, or expired."};
  return this.service.validate(token,request);
 }
 revoke(tokenId:string){this.registry.revoke(tokenId);}
 revokeMission(missionId:string){this.registry.revokeMission(missionId);}
 active(){return this.registry.listActive();}
}
