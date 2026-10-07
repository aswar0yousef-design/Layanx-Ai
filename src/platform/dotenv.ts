/** Minimal .env parser: KEY=VALUE, optional quotes, # comments. */
export function parseDotEnv(text:string):Array<{key:string;value:string;line:number}>{
  const out:Array<{key:string;value:string;line:number}>=[];
  text.split(/\r?\n/).forEach((raw,line)=>{
    const m=/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(raw);
    if(!m||!m[1])return;
    let value=(m[2]??"").trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    else value=value.replace(/\s+#.*$/,"");
    out.push({key:m[1],value,line});
  });
  return out;
}
