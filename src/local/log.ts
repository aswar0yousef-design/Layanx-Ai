import fs from "node:fs";

export type LogLevel="info"|"warn"|"error";
export type Logger=(level:LogLevel,message:string)=>void;

const MAX_BYTES=5*1024*1024;

/**
 * The desktop launcher starts LayanX in a hidden window, so everything written
 * to stdout/stderr (including the existing runtime's own output) is copied to
 * %LOCALAPPDATA%\LayanX\logs\layanx.log as well.
 */
export function installLogTee(file:string):void{
  try{
    if(fs.existsSync(file)&&fs.statSync(file).size>MAX_BYTES)fs.renameSync(file,file+".1");
  }catch{}
  const stream=fs.createWriteStream(file,{flags:"a",mode:0o600});
  stream.on("error",()=>undefined);
  for(const target of [process.stdout,process.stderr]){
    const original=target.write.bind(target) as (...args:unknown[])=>boolean;
    (target as unknown as {write:(...args:unknown[])=>boolean}).write=(chunk:unknown,...rest:unknown[])=>{
      try{stream.write(typeof chunk==="string"||chunk instanceof Uint8Array?chunk:String(chunk));}catch{}
      try{return original(chunk,...rest);}catch{return true;}
    };
  }
}

export const consoleLogger:Logger=(level,message)=>{
  const line=`${new Date().toISOString()} [layanx-local] ${level.toUpperCase()} ${message}`;
  if(level==="error")console.error(line);else console.log(line);
};
