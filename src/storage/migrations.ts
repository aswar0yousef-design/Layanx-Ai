export interface MigrationContext{
  get<T>(key:string):Promise<T|undefined>;
  set<T>(key:string,value:T):Promise<void>;
}

export interface Migration{
  version:number;
  name:string;
  up:(context:MigrationContext)=>Promise<void>;
}

export class MigrationRunner{
  constructor(private readonly migrations:Migration[],private readonly current=0){}
  async plan(){
    const seen=new Set<number>();
    for(const migration of this.migrations){
      if(seen.has(migration.version))throw new Error(`Duplicate migration version: ${migration.version}`);
      seen.add(migration.version);
    }
    return this.migrations.filter(m=>m.version>this.current).sort((a,b)=>a.version-b.version);
  }

  async run(context:MigrationContext):Promise<number>{
    const planned=await this.plan();
    let version=this.current;
    for(const migration of planned){
      if(migration.version!==version+1)throw new Error(`Migration gap before version ${migration.version}.`);
      await migration.up(context);
      version=migration.version;
      await context.set("storage:schemaVersion",version);
    }
    return version;
  }
}
