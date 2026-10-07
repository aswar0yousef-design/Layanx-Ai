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
 *     project folder and its sandbox temp/cache/home folders Low; the project's .git stays Medium, so a
 *     script cannot plant git hooks that LayanX would later run. Processes are protected the same way:
 *     the command cannot open LayanX's process.
 *   - all privileges removed and the Administrators group (if any) set to deny-only.
 *   - a Job Object: memory limit, at most 256 processes, and the whole process tree dies when the
 *     launcher stops (timeouts and "stop" really stop everything).
 * (A write-restricted token was tried first: Windows gives named pipes a fixed ACL, so child processes
 *  with pipes failed under it. Low integrity keeps pipes, npm and build tools working.)
 *
 * Not covered (documented for the owner): reading files and network access. Docker isolation covers both.
 */
export const LAUNCHER_VERSION="2";
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

  public static int Main(string[] args) {
    try {
      if (args.Length == 1 && args[0] == "version") { Console.Out.WriteLine("lx-sandbox ${LAUNCHER_VERSION}"); return 0; }
      if (args.Length > 1 && args[0] == "run") return Run(args);
      Console.Error.WriteLine("usage: lx-sandbox run --mem BYTES --procs N --cwd DIR --exe PATH --cmdline BASE64");
      return 2;
    } catch (Exception e) { Console.Error.WriteLine("lx-sandbox: " + e.Message); return 125; }
  }

  static string Opt(string[] args, string name) {
    for (int i = 1; i + 1 < args.Length; i++) if (args[i] == name) return args[i + 1];
    return null;
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

export interface RestrictedSetup{launcher:string;tmp:string;cache:string;home:string}
function icacls(env:NodeJS.ProcessEnv){return path.join(env.SystemRoot||env.WINDIR||"C:\\Windows","System32","icacls.exe");}
/** Set the integrity label of a folder and everything in it; new files inherit it. */
export async function labelFolder(dir:string,level:"L"|"M",env:NodeJS.ProcessEnv=process.env,recursive=true):Promise<void>{
  const r=await run(icacls(env),[dir,"/setintegritylevel",`(OI)(CI)${level}`,...(recursive?["/T"]:[]),"/C","/Q"],15*60_000);
  if(r.code!==0)throw new Error(`Could not set the ${level==="L"?"low":"medium"} integrity label on ${dir}: ${r.out.slice(-500)}`);
}
function readMarker(file:string):Record<string,string>{try{return JSON.parse(fs.readFileSync(file,"utf8")) as Record<string,string>;}catch{return{};}}
/**
 * Prepare a project for restricted runs: the project folder and the sandbox temp/cache/home folders are
 * labelled Low (writable by the command), the project's .git is labelled Medium again (not writable).
 * Done once per folder (remembered); labelling a large existing node_modules takes a moment once.
 */
export async function prepareRestricted(dir:string,env:NodeJS.ProcessEnv=process.env):Promise<RestrictedSetup>{
  const launcher=await ensureLauncher(env);
  const root=sandboxRoot(env);
  const tmp=path.join(root,"tmp"),cache=path.join(root,"cache"),home=path.join(root,"home");
  const marker=path.join(root,"prepared.json");
  const done=readMarker(marker);
  for(const d of [tmp,cache,home,dir]){
    const key=path.resolve(d).toLowerCase();
    if(done[key]==="L"&&fs.existsSync(d))continue;
    fs.mkdirSync(d,{recursive:true});
    await labelFolder(path.resolve(d),"L",env);
    done[key]="L";
  }
  fs.writeFileSync(marker,JSON.stringify(done,null,2));
  await protectGit(dir,env);
  return{launcher,tmp,cache,home};
}
/**
 * .git keeps Medium integrity, so the command cannot change hooks, config or history. The first time the
 * whole tree is relabelled; afterwards only the folder itself (cheap), which re-applies the label to
 * everything that inherits it - also when .git was deleted and created again.
 */
export async function protectGit(dir:string,env:NodeJS.ProcessEnv=process.env):Promise<void>{
  const git=path.join(dir,".git");
  if(!fs.existsSync(git))return;
  const marker=path.join(sandboxRoot(env),"prepared.json");
  const done=readMarker(marker);const key=path.resolve(git).toLowerCase();
  await labelFolder(path.resolve(git),"M",env,done[key]!=="M");
  if(done[key]!=="M"){done[key]="M";fs.writeFileSync(marker,JSON.stringify(done,null,2));}
}

/** Folders and caches the command may write besides the project (everything else in the profile is read-only). */
export function restrictedEnv(base:NodeJS.ProcessEnv,setup:RestrictedSetup,opts:{home?:boolean}={}):NodeJS.ProcessEnv{
  return{...base,TEMP:setup.tmp,TMP:setup.tmp,npm_config_cache:path.join(setup.cache,"npm"),PIP_CACHE_DIR:path.join(setup.cache,"pip"),XDG_CACHE_HOME:setup.cache,
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

/** After a run: a .git folder the command created itself is labelled Medium too (LayanX's later git calls stay safe). */
export async function denyGitAfterRun(dir:string,_setup?:RestrictedSetup,env:NodeJS.ProcessEnv=process.env):Promise<void>{
  await protectGit(dir,env).catch(()=>undefined);
}
