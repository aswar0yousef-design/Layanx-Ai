import fs from "node:fs";
import path from "node:path";

/**
 * On Windows `node_modules/.bin/tsx` is a shell script and `tsx.cmd` is a
 * batch file. Since the CVE-2024-27980 fix, Node refuses to spawn .cmd/.bat
 * files with `shell:false` (it throws EINVAL), and enabling the shell
 * re-introduces argument-injection risk.
 *
 * The portable and safe way is to run the package's JavaScript entry point
 * with the current Node binary:  spawn(process.execPath, [binJs, ...args]).
 */
export function resolvePackageBin(pkg:string,bin?:string,fromDir:string=process.cwd()):string{
  let dir=path.resolve(fromDir);
  for(;;){
    const manifest=path.join(dir,"node_modules",pkg,"package.json");
    if(fs.existsSync(manifest)){
      const json=JSON.parse(fs.readFileSync(manifest,"utf8")) as {bin?:string|Record<string,string>};
      const name=bin??pkg.split("/").pop()??pkg;
      const rel=typeof json.bin==="string"?json.bin:json.bin?.[name];
      if(!rel)throw new Error(`Package ${pkg} has no "${name}" bin entry.`);
      return path.resolve(path.dirname(manifest),rel);
    }
    const parent=path.dirname(dir);
    if(parent===dir)throw new Error(`Cannot find ${pkg} in node_modules above ${fromDir}. Run npm install.`);
    dir=parent;
  }
}

export function nodeToolCommand(pkg:string,args:string[],fromDir?:string,bin?:string):{command:string;args:string[]}{
  return{command:process.execPath,args:[resolvePackageBin(pkg,bin,fromDir),...args]};
}

/**
 * Some executables are installed as `name.exe` on Windows (Python/pip
 * scripts, ffmpeg, git). spawn() with shell:false finds `.exe` and `.com`
 * through PATH, but never `.cmd`/`.bat`. Detect that case early with a clear
 * message instead of a cryptic EINVAL/ENOENT.
 */
export function assertSpawnable(command:string,platform:NodeJS.Platform=process.platform):void{
  if(platform!=="win32")return;
  const ext=path.extname(command).toLowerCase();
  if(ext===".cmd"||ext===".bat")
    throw new Error(`"${command}" is a batch file. Run its JavaScript/EXE entry directly; batch files cannot be spawned without a shell on Windows.`);
}
