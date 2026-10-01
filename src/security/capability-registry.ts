import type {CapabilityToken} from "./capability-token.js";
export class CapabilityRegistry{
 private readonly active=new Map<string,CapabilityToken>();
 issue(token:CapabilityToken){this.active.set(token.id,token);return token;}
 revoke(id:string){this.active.delete(id);}
 revokeMission(missionId:string){for(const [id,t] of this.active)if(t.missionId===missionId)this.active.delete(id);}
 get(id:string){return this.active.get(id);}
 isActive(id:string){const t=this.active.get(id);return !!t&&Date.parse(t.expiresAt)>Date.now();}
 listActive(){return[...this.active.values()].filter(t=>Date.parse(t.expiresAt)>Date.now());}
}
