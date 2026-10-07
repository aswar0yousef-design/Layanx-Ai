import {execFile} from "node:child_process";
import {createHash} from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * "restricted" isolation on Windows, without Docker and without administrator rights.
 *
 * A tiny launcher (C#, compiled once with the .NET Framework compiler that ships with Windows) starts
 * the project command with:
 *   - a LOW-INTEGRITY token: Windows refuses writes from it to anything labelled Medium, which is every
 *     unlabelled file - the user's profile, LayanX's own data, other projects. LayanX labels only the
 *     project folder and its own sandbox temp/cache/home folders Low; the project's .git stays Medium, so a
 *     script cannot plant git hooks that LayanX would later run. Processes are protected the same way:
 *     the command cannot open LayanX's process.
 *   - all privileges removed and the Administrators group (if any) set to deny-only.
 *   - a Job Object: memory limit, at most 256 processes, and the whole process tree dies when the
 *     launcher stops (timeouts and "stop" really stop everything).
 *   - LayanX's own data folder gets a Medium label with no-read-up: the command cannot read the secret
 *     store, sessions or launch tickets (reading them would let it act as the owner through the local API).
 *   - .git is checked before and after each run: a replaced or newly created .git is moved aside, and
 *     LayanX's own git commands in these folders run without hooks or fsmonitor (husky/lefthook hooks live
 *     in files the command can change).
 * (A write-restricted token was tried first: Windows gives named pipes a fixed ACL, so child processes
 *  with pipes failed under it. Low integrity keeps pipes, npm and build tools working.)
 *
 * Not covered (documented for the owner): reading files and network access. Docker isolation covers both.
 */
export const LAUNCHER_VERSION="3";
export const LAUNCHER_CS=String.raw`
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

public static class LxSandbox {
  [StructLayout(LayoutKind.Sequential)] public struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential)] public struct TOKEN_MANDATORY_LABEL { public SID_AND_ATTRIBUTES Label; }
  [StructLayout(LayoutKind.Sequential)] public struct TOKEN_OWNER { public IntPtr Owner; }
  [StructLayout(LayoutKind.Sequential)] public struct TOKEN_DEFAULT_DACL { public IntPtr DefaultDacl; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public int dwX; public int dwY; public int dwXSize; public int dwYSize; public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags;
    public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError; }
  [StructLayout(LayoutKind.Sequential)] public struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public int dwProcessId; public int dwThreadId; }
  [StructLayout(LayoutKind.Sequential)] public struct IO_COUNTERS { public ulong a; public ulong b; public ulong c; public ulong d; public ulong e; public ulong f; }
  [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_BASIC_LIMIT_INFORMATION { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] public struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION { public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }

  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr h, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool CreateRestrictedToken(IntPtr existing, uint flags, uint disableCount, SID_AND_ATTRIBUTES[] disable, uint deleteCount, IntPtr deletePrivileges, uint restrictCount, IntPtr restrict, out IntPtr newToken);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int cls, IntPtr buffer, int length, out int returned);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr token, int cls, ref TOKEN_MANDATORY_LABEL info, int length);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr token, int cls, ref TOKEN_OWNER info, int length);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr token, int cls, ref TOKEN_DEFAULT_DACL info, int length);
  [DllImport("advapi32.dll")] static extern int GetLengthSid(IntPtr sid);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessAsUserW(IntPtr token, string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObjectW(IntPtr sa, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryInformationJobObject(IntPtr job, int cls, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint ms);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr GetStdHandle(int which);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSidToSidW(string sid, out IntPtr native);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string sddl, uint revision, out IntPtr sd, out uint size);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetSecurityDescriptorSacl(IntPtr sd, out bool present, out IntPtr sacl, out bool defaulted);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)] static extern uint SetNamedSecurityInfoW(string name, int type, uint info, IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);

  public static int Main(string[] args) {
    try {
      if (args.Length == 1 && args[0] == "version") { Console.Out.WriteLine("lx-sandbox ${LAUNCHER_VERSION}"); return 0; }
      if (args.Length == 2 && args[0] == "protect") { Protect(args[1]); return 0; }
      if (args.Length > 1 && args[0] == "run") return Run(args);
      Console.Error.WriteLine("usage: lx-sandbox run --mem BYTES --procs N --cwd DIR --exe PATH --cmdline BASE64 | protect DIR");
      return 2;
    } catch (Exception e) { Console.Error.WriteLine("lx-sandbox: " + e.Message); return 125; }
  }

  static string Opt(string[] args, string name) {
    for (int i = 1; i + 1 < args.Length; i++) if (args[i] == name) return args[i + 1];
    return null;
  }
  // Medium label with NO_READ_UP and NO_WRITE_UP, inherited: low-integrity commands can neither read nor
  // change what is inside (LayanX's secrets, sessions, launch tickets, logs).
  static void Protect(string dir) {
    IntPtr sd; uint size;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW("S:(ML;OICI;NRNW;;;ME)", 1, out sd, out size)) throw new Win32Exception(Marshal.GetLastWin32Error(), "label");
    bool present, defaulted; IntPtr sacl;
    if (!GetSecurityDescriptorSacl(sd, out present, out sacl, out defaulted) || !present) { LocalFree(sd); throw new Win32Exception(Marshal.GetLastWin32Error(), "label SACL"); }
    uint rc = SetNamedSecurityInfoW(dir, 1 /* SE_FILE_OBJECT */, 0x10 /* LABEL_SECURITY_INFORMATION */, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
    LocalFree(sd);
    if (rc != 0) throw new Win32Exception((int)rc, "SetNamedSecurityInfo " + dir);
  }

  static IntPtr NativeSid(string sid) {
    IntPtr p;
    if (!ConvertStringSidToSidW(sid, out p)) throw new Win32Exception(Marshal.GetLastWin32Error(), "SID " + sid);
    return p;
  }

  static int Run(string[] args) {
    string cwd = Opt(args, "--cwd"), exe = Opt(args, "--exe"), b64 = Opt(args, "--cmdline");
    if (cwd == null || exe == null || b64 == null) throw new ArgumentException("--cwd, --exe and --cmdline are required");
    ulong mem = 4UL << 30; uint procs = 256;
    if (Opt(args, "--mem") != null) mem = ulong.Parse(Opt(args, "--mem"));
    if (Opt(args, "--procs") != null) procs = uint.Parse(Opt(args, "--procs"));
    string cmdline = Encoding.UTF8.GetString(Convert.FromBase64String(b64));

    IntPtr token;
    if (!OpenProcessToken(GetCurrentProcess(), 0x02000000 /* MAXIMUM_ALLOWED */, out token)) throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcessToken");

    // Groups of this token: the logon SID (for the default DACL) and whether Administrators is present.
    int needed;
    GetTokenInformation(token, 2 /* TokenGroups */, IntPtr.Zero, 0, out needed);
    IntPtr groups = Marshal.AllocHGlobal(needed);
    if (!GetTokenInformation(token, 2, groups, needed, out needed)) throw new Win32Exception(Marshal.GetLastWin32Error(), "GetTokenInformation");
    int count = Marshal.ReadInt32(groups);
    int entry = Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES));
    SecurityIdentifier logon = null; bool admins = false;
    for (int i = 0; i < count; i++) {
      SID_AND_ATTRIBUTES g = (SID_AND_ATTRIBUTES)Marshal.PtrToStructure(new IntPtr(groups.ToInt64() + IntPtr.Size + i * entry), typeof(SID_AND_ATTRIBUTES));
      SecurityIdentifier gs = new SecurityIdentifier(g.Sid);
      if ((g.Attributes & 0xC0000000) == 0xC0000000) logon = gs;
      if (gs.Value == "S-1-5-32-544") admins = true;
    }
    Marshal.FreeHGlobal(groups);

    SID_AND_ATTRIBUTES[] disable = admins ? new SID_AND_ATTRIBUTES[] { new SID_AND_ATTRIBUTES { Sid = NativeSid("S-1-5-32-544") } } : new SID_AND_ATTRIBUTES[0];
    IntPtr restricted;
    if (!CreateRestrictedToken(token, 0x1 /* DISABLE_MAX_PRIVILEGE */, (uint)disable.Length, disable, 0, IntPtr.Zero, 0, IntPtr.Zero, out restricted))
      throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateRestrictedToken");

    // Low integrity (S-1-16-4096): no writes to Medium (= every unlabelled) object.
    IntPtr low = NativeSid("S-1-16-4096");
    TOKEN_MANDATORY_LABEL tml = new TOKEN_MANDATORY_LABEL();
    tml.Label.Sid = low; tml.Label.Attributes = 0x20; /* SE_GROUP_INTEGRITY */
    if (!SetTokenInformation(restricted, 25 /* TokenIntegrityLevel */, ref tml, Marshal.SizeOf(typeof(TOKEN_MANDATORY_LABEL)) + GetLengthSid(low)))
      throw new Win32Exception(Marshal.GetLastWin32Error(), "SetTokenInformation(TokenIntegrityLevel)");

    // New objects (pipes, files) are owned by the user, not by a deny-only Administrators group.
    SecurityIdentifier user = WindowsIdentity.GetCurrent().User;
    IntPtr userSid = NativeSid(user.Value);
    TOKEN_OWNER owner = new TOKEN_OWNER(); owner.Owner = userSid;
    if (!SetTokenInformation(restricted, 4 /* TokenOwner */, ref owner, IntPtr.Size)) throw new Win32Exception(Marshal.GetLastWin32Error(), "SetTokenInformation(TokenOwner)");
    RawAcl acl = new RawAcl(GenericAcl.AclRevision, 3);
    SecurityIdentifier[] full = logon != null
      ? new SecurityIdentifier[] { user, new SecurityIdentifier("S-1-5-18"), logon }
      : new SecurityIdentifier[] { user, new SecurityIdentifier("S-1-5-18") };
    for (int i = 0; i < full.Length; i++) acl.InsertAce(i, new CommonAce(AceFlags.None, AceQualifier.AccessAllowed, 0x10000000 /* GENERIC_ALL */, full[i], false, null));
    byte[] bin = new byte[acl.BinaryLength]; acl.GetBinaryForm(bin, 0);
    IntPtr dacl = Marshal.AllocHGlobal(bin.Length); Marshal.Copy(bin, 0, dacl, bin.Length);
    TOKEN_DEFAULT_DACL dd = new TOKEN_DEFAULT_DACL(); dd.DefaultDacl = dacl;
    if (!SetTokenInformation(restricted, 6 /* TokenDefaultDacl */, ref dd, IntPtr.Size)) throw new Win32Exception(Marshal.GetLastWin32Error(), "SetTokenInformation(TokenDefaultDacl)");

    IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
    limits.BasicLimitInformation.LimitFlags = 0x2000 /* KILL_ON_JOB_CLOSE */ | 0x8 /* ACTIVE_PROCESS */ | 0x200 /* JOB_MEMORY */ | 0x400 /* DIE_ON_UNHANDLED_EXCEPTION */;
    limits.BasicLimitInformation.ActiveProcessLimit = procs;
    limits.JobMemoryLimit = new UIntPtr(mem);
    if (!SetInformationJobObject(job, 9 /* JobObjectExtendedLimitInformation */, ref limits, Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))))
      throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject");

    STARTUPINFO si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    si.dwFlags = 0x100; /* STARTF_USESTDHANDLES */
    si.hStdInput = GetStdHandle(-10); si.hStdOutput = GetStdHandle(-11); si.hStdError = GetStdHandle(-12);
    foreach (IntPtr h in new IntPtr[] { si.hStdInput, si.hStdOutput, si.hStdError }) if (h != IntPtr.Zero && h != new IntPtr(-1)) SetHandleInformation(h, 1, 1);
    PROCESS_INFORMATION pi;
    if (!CreateProcessAsUserW(restricted, exe, new StringBuilder(cmdline, cmdline.Length + 1), IntPtr.Zero, IntPtr.Zero, true, 0x4 /* CREATE_SUSPENDED */ | 0x08000000 /* CREATE_NO_WINDOW */, IntPtr.Zero, cwd, ref si, out pi))
      throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcessAsUser " + exe);
    if (!AssignProcessToJobObject(job, pi.hProcess)) {
      int err = Marshal.GetLastWin32Error();
      TerminateProcess(pi.hProcess, 125);
      throw new Win32Exception(err, "AssignProcessToJobObject");
    }
    ResumeThread(pi.hThread); CloseHandle(pi.hThread);
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code; GetExitCodeProcess(pi.hProcess, out code);
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION used = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
    if (code != 0 && QueryInformationJobObject(job, 9, ref used, Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION)), IntPtr.Zero) && used.PeakJobMemoryUsed.ToUInt64() >= mem / 100 * 95)
      Console.Error.WriteLine("lx-sandbox: the command reached the memory limit (" + (mem >> 20) + " MB).");
    CloseHandle(pi.hProcess);
    // Leaving the job handle open until exit: KILL_ON_JOB_CLOSE then ends anything the command left behind.
    return (int)code;
  }
}
`;

/** Quote one argument the way CommandLineToArgvW / the MS C runtime parse it (same rules as libuv). */
export function quoteWindowsArg(arg:string):string{
  if(arg==="")return '""';
  if(!/[\s"]/.test(arg))return arg;
  let out='"',slashes=0;
  for(const ch of arg){
    if(ch==="\\"){slashes++;continue;}
    if(ch==='"'){out+="\\".repeat(slashes*2+1)+'"';slashes=0;continue;}
    out+="\\".repeat(slashes)+ch;slashes=0;
  }
  return out+"\\".repeat(slashes*2)+'"';
}
export function windowsCommandLine(command:string,args:string[]):string{return[command,...args].map(quoteWindowsArg).join(" ");}

/** Memory limit shared with Docker isolation (LAYANX_DOCKER_MEMORY, e.g. 4g or 1536m). */
export function sandboxMemoryBytes(env:NodeJS.ProcessEnv=process.env):number{
  const m=/^(\d+)([mg])$/i.exec(env.LAYANX_DOCKER_MEMORY?.trim()??"");
  if(!m)return 4*1024**3;
  return Number(m[1])*(m[2]!.toLowerCase()==="g"?1024**3:1024**2);
}

function storeDir(env:NodeJS.ProcessEnv){return path.resolve(env.LAYANX_STORE_DIR?.trim()||".layanx");}
export function sandboxRoot(env:NodeJS.ProcessEnv=process.env){return path.join(storeDir(env),"sandbox");}

export function cscPath(env:NodeJS.ProcessEnv=process.env):string|null{
  const win=env.WINDIR||env.SystemRoot||"C:\\Windows";
  for(const fw of ["Framework64","Framework"]){const p=path.join(win,"Microsoft.NET",fw,"v4.0.30319","csc.exe");if(fs.existsSync(p))return p;}
  return null;
}
export function launcherPath(env:NodeJS.ProcessEnv=process.env):string{
  const hash=createHash("sha256").update(LAUNCHER_CS).digest("hex").slice(0,12);
  return path.join(storeDir(env),"bin",`lx-sandbox-${hash}.exe`);
}
function run(command:string,args:string[],timeout=120_000):Promise<{code:number|null;out:string}>{
  return new Promise(resolve=>execFile(command,args,{windowsHide:true,timeout,maxBuffer:4*1024*1024},(err,stdout,stderr)=>{
    resolve({code:err?(typeof (err as {code?:unknown}).code==="number"?(err as {code:number}).code:1):0,out:String(stdout)+String(stderr)});
  }));
}

let compiling:Promise<string>|null=null;
/** Compile the launcher once (a few seconds); later runs reuse the .exe named after the source hash. */
export function ensureLauncher(env:NodeJS.ProcessEnv=process.env):Promise<string>{
  const exe=launcherPath(env);
  if(fs.existsSync(exe))return Promise.resolve(exe);
  if(compiling)return compiling;
  compiling=(async()=>{
    if(process.platform!=="win32")throw new Error("Restricted isolation runs on Windows only.");
    const csc=cscPath(env);
    if(!csc)throw new Error("Restricted isolation needs the .NET Framework 4 compiler (csc.exe), which is part of Windows 10 and 11.");
    fs.mkdirSync(path.dirname(exe),{recursive:true});
    const src=exe.replace(/\.exe$/,".cs"),tmp=exe+".tmp";
    fs.writeFileSync(src,LAUNCHER_CS);
    const r=await run(csc,["/nologo","/target:exe","/optimize+","/out:"+tmp,src]);
    if(r.code!==0||!fs.existsSync(tmp))throw new Error("Could not compile the sandbox launcher: "+r.out.slice(-800));
    fs.renameSync(tmp,exe);
    return exe;
  })().finally(()=>{compiling=null;});
  return compiling;
}

export interface RestrictedSetup{launcher:string;tmp:string;cache:string;home:string;
  /** Set when preparing found the project's .git replaced since LayanX last saw it (and undid that). */
  gitWarning?:string}
function icacls(env:NodeJS.ProcessEnv){return path.join(env.SystemRoot||env.WINDIR||"C:\\Windows","System32","icacls.exe");}
/** Set the integrity label of a folder and everything in it; new files inherit it. */
export async function labelFolder(dir:string,level:"L"|"M",env:NodeJS.ProcessEnv=process.env,recursive=true):Promise<void>{
  const r=await run(icacls(env),[dir,"/setintegritylevel",`(OI)(CI)${level}`,...(recursive?["/T"]:[]),"/C","/Q"],15*60_000);
  if(r.code!==0)throw new Error(`Could not set the ${level==="L"?"low":"medium"} integrity label on ${dir}: ${r.out.slice(-500)}`);
}

/** File identity (NTFS file index + creation time): survives renames, changes when a folder is replaced. */
export function fileIdentity(p:string):string|null{
  try{const st=fs.lstatSync(p,{bigint:true});return `${st.ino}:${st.birthtimeNs}`;}catch{return null;}
}
type Marker={folders:Record<string,{level:"L"|"M";id:string|null}>;protected:Record<string,string|boolean>};
const markerFile=(env:NodeJS.ProcessEnv)=>path.join(sandboxRoot(env),"prepared.json");
function readMarker(env:NodeJS.ProcessEnv):Marker{
  try{const m=JSON.parse(fs.readFileSync(markerFile(env),"utf8")) as Partial<Marker>;if(m&&typeof m.folders==="object")return{folders:m.folders??{},protected:m.protected??{}};}catch{}
  return{folders:{},protected:{}};
}
function writeMarker(env:NodeJS.ProcessEnv,m:Marker){fs.mkdirSync(sandboxRoot(env),{recursive:true});fs.writeFileSync(markerFile(env),JSON.stringify(m,null,2));markerCache=null;}
const keyOf=(p:string)=>path.resolve(p).toLowerCase();

/** LayanX's data folders: the data dir and the store (when the store lives elsewhere). */
export function protectedDataDirs(env:NodeJS.ProcessEnv=process.env):string[]{
  const data=env.LAYANX_DATA_DIR?.trim()||(env.LOCALAPPDATA?path.join(env.LOCALAPPDATA,"LayanX"):"");
  const store=storeDir(env);
  const dirs=[data,store].filter(Boolean).map(d=>path.resolve(d));
  return dirs.filter((d,i)=>fs.existsSync(d)&&!dirs.some((o,j)=>j!==i&&keyOf(d).startsWith(keyOf(o)+path.sep)));
}

/**
 * Prepare a project for restricted runs. The project folder and the sandbox temp/cache/home folders are
 * labelled Low (writable by the command); .git is labelled Medium (not writable); LayanX's data is
 * labelled Medium no-read-up. Remembered per folder identity, so a folder that was deleted and created
 * again is labelled again. Labelling a large existing node_modules takes a moment the first time.
 */
export async function prepareRestricted(dir:string,env:NodeJS.ProcessEnv=process.env):Promise<RestrictedSetup>{
  const launcher=await ensureLauncher(env);
  const root=sandboxRoot(env);
  const own=projectSandboxDir(dir,env);
  const tmp=path.join(own,"tmp"),cache=path.join(own,"cache"),home=path.join(own,"home");
  const m=readMarker(env);
  const dirKnown=m.folders[keyOf(dir)];
  const dirFresh=!(dirKnown?.level==="L"&&dirKnown.id===fileIdentity(dir));
  if(dirFresh&&fs.existsSync(dir))refuseSharedPnpmStore(dir,cache);
  for(const d of [tmp,cache,home,dir]){
    fs.mkdirSync(d,{recursive:true});
    const k=keyOf(d),id=fileIdentity(d),known=m.folders[k];
    if(known?.level==="L"&&known.id===id)continue;
    await labelFolder(path.resolve(d),"L",env);
    m.folders[k]={level:"L",id};
  }
  // A project folder that was deleted and created again: its old .git record no longer applies.
  if(dirFresh)delete m.folders[keyOf(path.join(dir,".git"))];
  fs.mkdirSync(path.join(root,"no-hooks"),{recursive:true});
  for(const d of protectedDataDirs(env)){
    const id=fileIdentity(d)??"";
    if(m.protected[keyOf(d)]===id)continue;
    const r=await run(launcher,["protect",d],15*60_000);
    if(r.code!==0)throw new Error("Could not protect LayanX's data folder from sandboxed commands: "+r.out.slice(-400));
    m.protected[keyOf(d)]=id;
  }
  writeMarker(env,m);
  const gitWarning=await reconcileGit(dir,env);
  return{launcher,tmp,cache,home,...(gitWarning?{gitWarning}:{})};
}

/** Each project gets its own temp, cache and home folders: one sandboxed project cannot poison another's caches or settings. */
export function projectSandboxDir(dir:string,env:NodeJS.ProcessEnv=process.env):string{
  const name=path.basename(path.resolve(dir)).toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"").slice(0,32)||"project";
  return path.join(sandboxRoot(env),"projects",name+"-"+createHash("sha256").update(keyOf(dir)).digest("hex").slice(0,10));
}

/**
 * pnpm hard-links package files from one shared store. Labelling such a node_modules would label the
 * shared store files too, and every sandboxed project could then change packages that other projects use.
 */
export function refuseSharedPnpmStore(dir:string,ownCache:string):void{
  let yaml="";
  try{yaml=fs.readFileSync(path.join(dir,"node_modules",".modules.yaml"),"utf8");}catch{return;}
  const store=/^\s*storeDir:\s*['"]?(.+?)['"]?\s*$/m.exec(yaml)?.[1];
  if(!store)return;
  const k=keyOf(store);
  if(k===keyOf(ownCache)||k.startsWith(keyOf(ownCache)+path.sep))return;
  throw new Error(`This project's node_modules links files from pnpm's shared store (${store}). Delete the project's node_modules folder once; in restricted isolation the packages are then installed with a store of the project's own.`);
}

/**
 * Before a run: adopt .git the first time LayanX sees it; if it was replaced since LayanX last saw it
 * (for example by a dev server that is still running), undo the swap instead of trusting the new one.
 */
async function reconcileGit(dir:string,env:NodeJS.ProcessEnv):Promise<string|undefined>{
  const git=path.join(dir,".git");
  const known=readMarker(env).folders[keyOf(git)];
  const now=fileIdentity(git);
  if(known?.level==="M"&&known.id&&now!==known.id)return verifyGitAfterRun(dir,{id:known.id},env);
  await protectGit(dir,env);
  return undefined;
}

/**
 * .git keeps Medium integrity, so the command cannot change hooks, config or history. The first time the
 * whole tree is relabelled; afterwards only the folder itself (cheap), which re-applies the label to
 * everything that inherits it.
 */
export async function protectGit(dir:string,env:NodeJS.ProcessEnv=process.env):Promise<void>{
  const git=path.join(dir,".git");
  const id=fileIdentity(git);
  if(!id)return;
  const m=readMarker(env);const k=keyOf(git);const known=m.folders[k];
  const same=known?.level==="M"&&known.id===id;
  await labelFolder(path.resolve(git),"M",env,!same);
  // Remembered (= trusted by LayanX's own git) unless it is new to LayanX and set up to start programs.
  if(same||!gitRunsPrograms(git)){m.folders[k]={level:"M",id};writeMarker(env,m);}
}

/** Undo the Low label when a project leaves restricted isolation (Medium again, like any other folder). */
export async function unprepareRestricted(dir:string,env:NodeJS.ProcessEnv=process.env):Promise<void>{
  const m=readMarker(env);const k=keyOf(dir);
  if(!m.folders[k])return;
  if(fs.existsSync(dir))await labelFolder(path.resolve(dir),"M",env);
  delete m.folders[k];delete m.folders[keyOf(path.join(dir,".git"))];
  // The project's own sandbox temp/cache/home are LayanX's: removed with the label.
  const own=projectSandboxDir(dir,env);
  for(const sub of ["tmp","cache","home"])delete m.folders[keyOf(path.join(own,sub))];
  fs.rmSync(own,{recursive:true,force:true});
  writeMarker(env,m);
}

/** What .git looked like before a run. */
export function gitSnapshot(dir:string):{id:string|null}{return{id:fileIdentity(path.join(dir,".git"))};}
/**
 * After a run: if the command replaced .git (renamed the real one away and made its own) or created one,
 * the new .git is moved aside and the original, found again by its identity, is put back. Returns a
 * warning for the result, or undefined when .git is unchanged.
 */
export async function verifyGitAfterRun(dir:string,before:{id:string|null},env:NodeJS.ProcessEnv=process.env):Promise<string|undefined>{
  const git=path.join(dir,".git");
  const now=fileIdentity(git);
  if(now===before.id){if(now)await protectGit(dir,env).catch(()=>undefined);return undefined;}
  const notes:string[]=[];
  if(now){const aside=path.join(dir,`.git-untrusted-${Date.now()}`);fs.renameSync(git,aside);notes.push(`moved the .git folder the command made to ${path.basename(aside)}`);}
  if(before.id){
    for(const name of fs.readdirSync(dir)){
      const p=path.join(dir,name);
      if(fileIdentity(p)===before.id){fs.renameSync(p,git);notes.push(`put the original .git back (it had been renamed to ${name})`);break;}
    }
    if(!fs.existsSync(git))notes.push("the original .git was not found in the project folder");
  }
  if(fs.existsSync(git))await protectGit(dir,env).catch(()=>undefined);
  return "A command changed the project's .git folder: LayanX "+notes.join(", and ")+".";
}

/** Folders and caches the command may write besides the project (everything else in the profile is read-only). */
export function restrictedEnv(base:NodeJS.ProcessEnv,setup:RestrictedSetup,opts:{home?:boolean}={}):NodeJS.ProcessEnv{
  return{...base,TEMP:setup.tmp,TMP:setup.tmp,npm_config_cache:path.join(setup.cache,"npm"),npm_config_store_dir:path.join(setup.cache,"pnpm-store"),PIP_CACHE_DIR:path.join(setup.cache,"pip"),XDG_CACHE_HOME:setup.cache,
    NUGET_PACKAGES:path.join(setup.cache,"nuget"),DOTNET_CLI_HOME:setup.home,DOTNET_SKIP_FIRST_TIME_EXPERIENCE:"1",DOTNET_CLI_TELEMETRY_OPTOUT:"1",DOTNET_NOLOGO:"1",PUB_CACHE:path.join(setup.cache,"pub"),
    ...(opts.home?{HOME:setup.home,USERPROFILE:setup.home,APPDATA:path.join(setup.home,"AppData","Roaming"),LOCALAPPDATA:path.join(setup.home,"AppData","Local")}:{})};
}

/** Resolve a program name the way CreateProcess needs it (a full path to an .exe/.com). */
export function resolveExecutable(command:string,env:NodeJS.ProcessEnv=process.env):string{
  if(path.win32.isAbsolute(command))return command;
  const exts=/\.(exe|com)$/i.test(command)?[""]:[".exe",".com"];
  for(const dir of (env.PATH??env.Path??"").split(";").filter(Boolean))for(const ext of exts){
    const p=path.join(dir,command+ext);if(fs.existsSync(p))return p;
  }
  throw new Error(`"${command}" was not found on PATH (restricted isolation starts programs by their full path).`);
}

/** argv that runs `cmd` through the launcher inside `dir`. */
export function restrictedCommand(cmd:{command:string;args:string[];label:string},dir:string,setup:RestrictedSetup,env:NodeJS.ProcessEnv=process.env):{command:string;args:string[];label:string}{
  const exe=resolveExecutable(cmd.command,env);
  const line=windowsCommandLine(exe,cmd.args);
  return{command:setup.launcher,label:"restricted: "+cmd.label,args:["run","--mem",String(sandboxMemoryBytes(env)),"--procs","256",
    "--cwd",dir,"--exe",exe,"--cmdline",Buffer.from(line,"utf8").toString("base64")]};
}

/**
 * Git settings that make git start another program (filters, diff/merge drivers, credential helpers,
 * ssh/askpass/pager/editor, includes of other config files). A sandboxed command could add them to a
 * .git it made; LayanX does not run git in such a repository.
 */
export function gitRunsPrograms(gitDir:string):boolean{
  let text="";
  try{text=fs.readFileSync(path.join(gitDir,"config"),"utf8");}catch{return false;}
  return /^\s*\[\s*include(if)?\b/im.test(text)
    ||/^\s*(fsmonitor|hookspath|sshcommand|pager|editor|askpass|gitproxy|external|textconv|command|program|helper|driver|clean|smudge|process|uploadpack|receivepack|alternaterefscommand)\s*=/im.test(text);
}

let markerCache:{at:number;file:string;low:string[];folders:Marker["folders"]}|null=null;
/**
 * Extra arguments for LayanX's OWN git commands. In a folder that sandboxed commands can write, hooks and
 * fsmonitor are switched off: husky/lefthook hooks are files in the project (or in node_modules), and
 * running them from LayanX would run code the sandboxed command wrote, outside the sandbox.
 * Throws (LayanX then does not run git there) when that folder's .git is not the one LayanX checked:
 * replaced while a sandboxed command was running, or new and set up to start programs.
 */
export function gitSafetyArgs(cwd:string,env:NodeJS.ProcessEnv=process.env):string[]{
  if(!markerCache||markerCache.file!==markerFile(env)||Date.now()-markerCache.at>2000){
    const m=readMarker(env);
    markerCache={at:Date.now(),file:markerFile(env),folders:m.folders,low:Object.entries(m.folders).filter(([,v])=>v.level==="L").map(([k])=>k)};
  }
  const k=keyOf(cwd);
  const owner=markerCache.low.find(f=>k===f||k.startsWith(f+path.sep));
  if(!owner)return[];
  let base=path.resolve(cwd);
  while(keyOf(base)!==owner&&path.dirname(base)!==base)base=path.dirname(base);
  const git=path.join(base,".git"),id=fileIdentity(git),known=markerCache.folders[keyOf(git)];
  if(id&&known?.level==="M"&&known.id&&known.id!==id)
    throw new Error(`The .git folder in ${base} was replaced while a sandboxed command was running. LayanX does not run git there; the next run in this project restores the original.`);
  if(id&&!known&&gitRunsPrograms(git))
    throw new Error(`The .git folder in ${base} was not checked by LayanX and its config starts programs (filters, drivers, helpers or includes). LayanX does not run git there.`);
  return["-c",`core.hooksPath=${path.join(sandboxRoot(env),"no-hooks")}`,"-c","core.fsmonitor=false"];
}
