import {createGitHubReadAdapter} from "../src/connectors/github-read.js";
const calls:Array<{url:string;authorization?:string}>=[];const fetcher=async(input:RequestInfo|URL,init?:RequestInit)=>{
 calls.push({url:String(input),authorization:(init?.headers as Record<string,string>)?.authorization});
 return new Response(JSON.stringify({name:"LayanX-Ai"}),{status:200,headers:{"content-type":"application/json"}});
};
const adapter=createGitHubReadAdapter({token:"test-token",fetcher});
const result=await adapter.execute({missionId:"m",agentId:"a",tool:"github.repo.read",action:"read repository",permission:"L1_READ",idempotencyKey:"1",payload:{repository:"aswar0yousef-design/Layanx-Ai"}});
if((result.data as {name:string}).name!=="LayanX-Ai")throw new Error("GitHub response was not parsed");
if(calls[0].url!=="https://api.github.com/repos/aswar0yousef-design/Layanx-Ai")throw new Error("GitHub URL was not constrained");
if(calls[0].authorization!=="Bearer test-token")throw new Error("GitHub token was not sent as bearer");
for(const value of ["bad","owner/a/b","../secret"]){
 let rejected=false;try{await adapter.execute({missionId:"m",agentId:"a",tool:"github.repo.read",action:"read repository",permission:"L1_READ",idempotencyKey:value,payload:{repository:value}});}catch(error){rejected=error instanceof Error&&error.message.includes("owner/repository");}
 if(!rejected)throw new Error("invalid repository accepted: "+value);
}
console.log("GitHub read connector tests passed.");
