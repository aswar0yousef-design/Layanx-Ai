import {OpenAICompatibleProvider} from "../models/http-providers.js";

export function createKimiProvider(options:{apiKey:string;baseUrl?:string;timeoutMs?:number}){
  if(!options.apiKey)throw new Error("Kimi credentials required.");
  return new OpenAICompatibleProvider({
    name:"kimi",
    apiKey:options.apiKey,
    baseUrl:options.baseUrl??"https://api.moonshot.ai/v1",
    timeoutMs:options.timeoutMs??30000
  });
}
