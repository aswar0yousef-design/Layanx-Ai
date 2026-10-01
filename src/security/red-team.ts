export interface SecurityCheck{name:string;run:()=>Promise<{passed:boolean;detail:string}>;}
export interface SecurityReport{timestamp:string;passed:number;failed:number;checks:Array<{name:string;passed:boolean;detail:string}>;}
export class RedTeamHarness{
 async run(checks:SecurityCheck[]):Promise<SecurityReport>{
  const results=[];
  for(const check of checks){try{const r=await check.run();results.push({name:check.name,...r});}catch(error){results.push({name:check.name,passed:false,detail:error instanceof Error?error.message:String(error)});}}
  return{timestamp:new Date().toISOString(),passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,checks:results};
 }
}
