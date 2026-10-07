/**
 * Embeddings for semantic memory through Ollama's /api/embed. The embedding model comes from
 * LAYANX_EMBEDDING_MODEL or the local host's model plan (LAYANX_OLLAMA_MODEL_PLAN.embedding, set when
 * an embedding model such as nomic-embed-text is installed). No model -> lexical memory only.
 */
export interface Embedder{model:string;embed(texts:string[]):Promise<number[][]>}

export function embeddingModelFromEnv(env:NodeJS.ProcessEnv=process.env):string|undefined{
 if(env.LAYANX_SEMANTIC_MEMORY==="off")return undefined;
 const explicit=env.LAYANX_EMBEDDING_MODEL?.trim();
 if(explicit)return explicit;
 try{const plan=JSON.parse(env.LAYANX_OLLAMA_MODEL_PLAN??"{}") as Record<string,unknown>;return typeof plan.embedding==="string"&&plan.embedding?plan.embedding:undefined;}
 catch{return undefined;}
}

export function createOllamaEmbedder(model:string,options:{baseUrl?:string;fetcher?:typeof fetch;timeoutMs?:number}={}):Embedder{
 const root=(options.baseUrl??process.env.OLLAMA_BASE_URL??"http://127.0.0.1:11434").replace(/\/$/,"");
 const fetcher=options.fetcher??fetch;
 return{model,async embed(texts){
  if(!texts.length)return[];
  const response=await fetcher(root+"/api/embed",{method:"POST",redirect:"error",headers:{"content-type":"application/json"},
   body:JSON.stringify({model,input:texts,keep_alive:process.env.OLLAMA_KEEP_ALIVE??"10m"}),signal:AbortSignal.timeout(options.timeoutMs??30_000)});
  if(!response.ok)throw new Error("Ollama embeddings returned HTTP "+response.status+".");
  const data=await response.json() as {embeddings?:number[][]};
  if(!Array.isArray(data.embeddings)||data.embeddings.length!==texts.length)throw new Error("Ollama returned no embeddings.");
  return data.embeddings;
 }};
}
