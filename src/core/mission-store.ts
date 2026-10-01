import type {Mission} from "./types.js";
export class MissionStore{
 private readonly missions=new Map<string,Mission>();
 save(mission:Mission){this.missions.set(mission.id,structuredClone(mission));return structuredClone(mission);}
 get(id:string){const mission=this.missions.get(id);return mission?structuredClone(mission):undefined;}
 list(){return [...this.missions.values()].map(mission=>structuredClone(mission));}
 update(id:string,patch:Partial<Mission>){const current=this.missions.get(id);if(!current)throw new Error("Unknown mission.");const next={...current,...patch};this.missions.set(id,next);return structuredClone(next);}
}