export interface Migration{version:number;name:string;up:()=>Promise<void>;}
export class MigrationRunner{
 constructor(private readonly migrations:Migration[],private readonly current=0){}
 async plan(){return this.migrations.filter(m=>m.version>this.current).sort((a,b)=>a.version-b.version);}
}
