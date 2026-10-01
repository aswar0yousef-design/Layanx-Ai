import type {ModelCapability,ModelDefinition} from "./registry.js";

export interface ModelRequest{
  capability:ModelCapability;
  input:string;
  maxOutputTokens?:number;
  metadata?:Record<string,unknown>;
}

export interface ModelResponse{
  modelId:string;
  provider:string;
  output:string;
  usage?:{inputTokens?:number;outputTokens?:number;costUsd?:number};
}

export interface ModelProviderAdapter{
  readonly name:string;
  health():Promise<{provider:string;available:boolean;latencyMs?:number;reason?:string;updatedAt:string}>;
  generate(model:ModelDefinition,request:ModelRequest):Promise<ModelResponse>;
}

export interface ModelExecutionAttempt{
  modelId:string;
  provider:string;
  ok:boolean;
  error?:string;
}

export interface ModelExecutionResult extends ModelResponse{
  attempts:ModelExecutionAttempt[];
}
