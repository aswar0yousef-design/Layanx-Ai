/**
 * Build a minimal environment for child processes.
 *
 * Spreading `...process.env` into spawn() hands every API key, OAuth token and
 * the vault master key to whatever program is being launched. Use this helper
 * at every spawn site instead, and allow extra variables explicitly.
 */
const WINDOWS_BASE=[
  "PATH","PATHEXT","SYSTEMROOT","SYSTEMDRIVE","WINDIR","COMSPEC","TEMP","TMP",
  "USERPROFILE","HOMEDRIVE","HOMEPATH","APPDATA","LOCALAPPDATA","PROGRAMDATA",
  "PROGRAMFILES","PROGRAMFILES(X86)","PROGRAMW6432","COMMONPROGRAMFILES",
  "NUMBER_OF_PROCESSORS","PROCESSOR_ARCHITECTURE","OS","USERNAME","USERDOMAIN","COMPUTERNAME"
];
const POSIX_BASE=["PATH","HOME","USER","LOGNAME","SHELL","LANG","LC_ALL","LC_CTYPE","TMPDIR","TERM","TZ"];

/** Names that must never be forwarded, even if a caller allows them by prefix. */
const ALWAYS_BLOCKED=/(^|_)(API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_?KEY|VAULT_?KEY|CLIENT_SECRET|REFRESH_TOKEN|ACCESS_TOKEN|COOKIE|CREDENTIALS?)(_|$)/i;

export interface SafeEnvOptions{
  /** Extra variable names to forward when present (case-insensitive on Windows). */
  allow?:string[];
  /** Forward variables whose name starts with one of these prefixes (secrets are still blocked). */
  allowPrefixes?:string[];
  /** Variables set explicitly for the child. These are trusted and always applied. */
  extra?:Record<string,string>;
  source?:NodeJS.ProcessEnv;
  platform?:NodeJS.Platform;
}

export function safeChildEnv(options:SafeEnvOptions={}):NodeJS.ProcessEnv{
  const platform=options.platform??process.platform;
  const source=options.source??process.env;
  const windows=platform==="win32";
  const norm=(name:string)=>windows?name.toUpperCase():name;
  const allowed=new Set([...(windows?WINDOWS_BASE:POSIX_BASE),...(options.allow??[])].map(norm));
  const prefixes=(options.allowPrefixes??[]).map(norm);
  const env:NodeJS.ProcessEnv={};
  for(const [name,value] of Object.entries(source)){
    if(value===undefined)continue;
    const key=norm(name);
    const byName=allowed.has(key);
    const byPrefix=prefixes.some(prefix=>key.startsWith(prefix));
    if(!byName&&!byPrefix)continue;
    if(byPrefix&&!byName&&ALWAYS_BLOCKED.test(name))continue;
    env[name]=value;
  }
  for(const [name,value] of Object.entries(options.extra??{}))env[name]=value;
  return env;
}
