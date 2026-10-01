export interface KnownGoodState{id:string;createdAt:string;version:string;checksum:string;metadata?:Record<string,unknown>;}
export class LastKnownGood{
 private current?:KnownGoodState;
 save(state:KnownGoodState){this.current={...state};}
 get(){return this.current;}
 clear(){this.current=undefined;}
}
