import path from "node:path";

/**
 * Windows-specific traps a POSIX-minded path check misses:
 *  - paths are case-insensitive:  C:\Work\..\work\secret  ==  c:\work\secret
 *  - a different drive letter makes path.relative() return an ABSOLUTE path
 *  - "file.txt:hidden" addresses an NTFS alternate data stream
 *  - "secret.env." and "secret.env " are silently trimmed to "secret.env"
 *  - CON, NUL, COM1, LPT1 ... are devices in every directory
 *  - \\?\ and \\.\ prefixes bypass normal path parsing
 */
const DEVICE_NAMES=/^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i;

export function isPathInside(root:string,target:string,platform:NodeJS.Platform=process.platform):boolean{
  const p=platform==="win32"?path.win32:path.posix;
  const resolvedRoot=p.resolve(root);
  const resolvedTarget=p.resolve(resolvedRoot,target);
  const a=platform==="win32"?resolvedRoot.toLowerCase():resolvedRoot;
  const b=platform==="win32"?resolvedTarget.toLowerCase():resolvedTarget;
  const rel=p.relative(a,b);
  if(rel==="")return true;
  return !rel.startsWith("..")&&!p.isAbsolute(rel);
}

export function assertSafeWorkspacePath(root:string,userPath:string,platform:NodeJS.Platform=process.platform):string{
  if(typeof userPath!=="string"||userPath.length===0||userPath.length>1024)throw new Error("Path must be a non-empty string.");
  if(userPath.includes("\0"))throw new Error("Path contains a NUL byte.");
  if(platform==="win32"){
    if(/^\\\\[?.]\\/.test(userPath))throw new Error("Device and extended-length paths are not allowed.");
    const withoutDrive=userPath.replace(/^[a-zA-Z]:/,"");
    if(withoutDrive.includes(":"))throw new Error("Alternate data streams are not allowed.");
    for(const segment of userPath.split(/[\\/]+/)){
      if(!segment||segment==="."||segment==="..")continue;
      if(/[. ]$/.test(segment))throw new Error(`Path segment "${segment}" ends with a dot or space.`);
      const base=segment.split(".")[0]??"";
      if(DEVICE_NAMES.test(base))throw new Error(`"${segment}" is a reserved Windows device name.`);
      if(/[<>"|?*\x00-\x1f]/.test(segment))throw new Error(`Path segment "${segment}" contains characters Windows does not allow.`);
    }
  }
  if(!isPathInside(root,userPath,platform))throw new Error("Path escapes the project workspace.");
  const p=platform==="win32"?path.win32:path.posix;
  return p.resolve(p.resolve(root),userPath);
}
