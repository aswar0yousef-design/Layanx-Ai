export function requiredEnv(name:string):string{const value=process.env[name];if(!value)throw new Error("Required environment variable is missing: "+name);return value;}
export function optionalEnv(name:string,defaultValue:string){return process.env[name]??defaultValue;}
