import type {ToolAdapter} from "../tools/executor.js";
import type {ToolRequest} from "../core/types.js";

const DEFAULT_BASE_URL="https://api.github.com";
const MAX_REPO_LENGTH=200;
const MAX_ITEMS=30;

function record(request:ToolRequest):Record<string,unknown>{
 return request.payload&&typeof request.payload==="object"&&!Array.isArray(request.payload)?request.payload as Record<string,unknown>:{};
}
function repo(input:unknown):string{
 if(typeof input!=="string"||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input)||input.length>MAX_REPO_LENGTH||input.split("/").some(part=>part==="."||part==="..")throw new Error("GitHub repository must use owner/repository format.");
 return input;
}
function count(input:unknown):number{
 return typeof input==="number"&&Number.isInteger(input)?Math.min(Math.max(input,1),MAX_ITEMS):10;
}
export function createGitHubReadAdapter(options:{token?:string;baseUrl?:string;fetcher?:typeof fetch}={}):ToolAdapter{
 const fetcher=options.fetcher??fetch;
 const root=(options.baseUrl??DEFAULT_BASE_URL).replace(/\/$/,"");
 return {async execute(request){
  const input=record(request);
  const repository=repo(input.repository);
  const headers:Record<string,string>={"accept":"application/vnd.github+json","x-github-api-version":"2022-11-28"};
  if(options.token)headers.authorization="Bearer "+options.token;
  const action=request.action.toLowerCase();
  let path:string;
  if(action==="read repository")path="/repos/"+repository;
  else if(action==="list issues")path="/repos/"+repository+"/issues?state=open&per_page="+count(input.limit);
  else if(action==="list pull requests")path="/repos/"+repository+"/pulls?state=open&per_page="+count(input.limit);
  else throw new Error("Unsupported GitHub read action.");
  const response=await fetcher(root+path,{method:"GET",redirect:"error",headers});
  const text=await response.text();
  if(!response.ok)throw new Error("GitHub API request failed with status "+response.status+".");
  try{return{status:response.status,data:JSON.parse(text)};}catch{return{status:response.status,data:text};}
 }};
}
