import type {ModelCapability,ModelDefinition} from "../models/registry.js";
export interface ModelRequest{model:string;capability:ModelCapability;input:string;maxTokens?:number;temperature?:number;}
export interface ModelResponse{provider:string;model:string;output:string;usage?:{inputTokens?:number;outputTokens?:number};}
export interface ModelClient{generate(request:ModelRequest):Promise<ModelResponse>;}
export interface ProviderAdapter{provider:string;supports(model:ModelDefinition):boolean;client():ModelClient;}
