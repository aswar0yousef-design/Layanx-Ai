import {spawn,execFileSync,type ChildProcessWithoutNullStreams} from "node:child_process";
import {existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,win32} from "node:path";
import {randomUUID} from "node:crypto";
import {createInterface} from "node:readline";
import {readFile,unlink} from "node:fs/promises";
import type {ToolRequest} from "../core/types.js";
import type {ToolAdapter} from "./executor.js";
import {safeChildEnv} from "../platform/safe-env.js";

type Runner=(command:string,args:string[],timeout?:number)=>Promise<{stdout:string;stderr:string;code:number|null}>;
const MAX_TEXT=4000,MAX_SCREENSHOT_BYTES=5*1024*1024;
const KEYS=new Set(["ENTER","TAB","ESC","ESCAPE","BACKSPACE","DELETE","SPACE","UP","DOWN","LEFT","RIGHT","HOME","END","PAGEUP","PAGEDOWN","SHIFT","CTRL","ALT","META","WIN","F1","F2","F3","F4","F5","F6","F7","F8","F9","F10","F11","F12"]);
function payload(r:ToolRequest){return r.payload&&typeof r.payload==="object"&&!Array.isArray(r.payload)?r.payload as Record<string,unknown>:{};}
function numberValue(v:unknown,n:string,max:number){if(typeof v!=="number"||!Number.isInteger(v)||v<0||v>max)throw new Error(n+" must be an integer between 0 and "+max+".");return v;}
function textValue(v:unknown){if(typeof v!=="string"||!v||v.length>MAX_TEXT)throw new Error("text must be a non-empty string of at most "+MAX_TEXT+" characters.");return v;}
/** One key ("ENTER", "a") or a combination ("CTRL+C", "CTRL+SHIFT+ESC", "WIN+R"). */
function keyValue(v:unknown){
 if(typeof v!=="string"||!v.trim())throw new Error("key is required.");
 const parts=v.trim().toUpperCase().split("+").map(p=>p.trim()).filter(Boolean);
 if(!parts.length||parts.length>4)throw new Error("Unsupported keyboard key.");
 for(const p of parts)if(!(p.length===1&&/[A-Z0-9]/.test(p))&&!KEYS.has(p))throw new Error("Unsupported keyboard key.");
 if(parts.length===1&&parts[0]!.length===1&&!/[A-Z0-9]/.test(parts[0]!))throw new Error("Unsupported keyboard key.");
 return parts.join("+");
}
function runner():Runner{return (command,args,timeout=10000)=>new Promise(resolve=>{const c=spawn(command,args,{shell:false,windowsHide:true,timeout,env:safeChildEnv({allow:["DISPLAY","XAUTHORITY","WAYLAND_DISPLAY","XDG_RUNTIME_DIR"]})});let stdout="",stderr="";c.stdout.setEncoding("utf8").on("data",(x:string)=>{if(stdout.length<8*1024*1024)stdout+=x;});c.stderr.setEncoding("utf8").on("data",(x:string)=>{stderr+=x.slice(0,65536);});c.on("error",e=>resolve({stdout,stderr:String(e),code:null}));c.on("close",code=>resolve({stdout,stderr,code}));});}

// --------------------------------------------------------------------------- Windows
/**
 * Windows backend: ONE long-lived PowerShell process with a compiled helper class.
 *
 * The previous version passed values after `-Command <script>`. PowerShell appends
 * those to the script text, so $args was empty (nothing happened) and typed text was
 * executed as PowerShell code. Here every request travels as one JSON line on stdin
 * (typed text base64-encoded) and is never parsed as code. Compiling once also makes
 * actions fast enough for the live screen (no Add-Type per call).
 *
 *  - SendInput with KEYEVENTF_UNICODE: Arabic and any Unicode text types correctly
 *  - SetProcessDPIAware: coordinates and screenshots match the real pixels on 125-150% scaling
 *  - key combinations: CTRL+C, ALT+TAB, WIN+R ...
 *  - screenshots as JPEG, downscaled to at most 1920 px wide (stays far below 5 MiB)
 */
const WIN_HELPER_CS=String.raw`
using System;using System.Runtime.InteropServices;using System.Drawing;using System.Drawing.Imaging;using System.IO;using System.Collections.Generic;using System.Windows.Forms;
public static class LxDesk{
 [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint n,INPUT[] inputs,int size);
 [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT{public int dx;public int dy;public uint mouseData;public uint dwFlags;public uint time;public IntPtr dwExtraInfo;}
 [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT{public ushort wVk;public ushort wScan;public uint dwFlags;public uint time;public IntPtr dwExtraInfo;}
 [StructLayout(LayoutKind.Sequential)] public struct HARDWAREINPUT{public uint uMsg;public ushort wParamL;public ushort wParamH;}
 [StructLayout(LayoutKind.Explicit)] public struct InputUnion{[FieldOffset(0)] public MOUSEINPUT mi;[FieldOffset(0)] public KEYBDINPUT ki;[FieldOffset(0)] public HARDWAREINPUT hi;}
 [StructLayout(LayoutKind.Sequential)] public struct INPUT{public uint type;public InputUnion U;}
 static void Send(List<INPUT> list){if(list.Count==0)return;var arr=list.ToArray();if(SendInput((uint)arr.Length,arr,Marshal.SizeOf(typeof(INPUT)))!=arr.Length)throw new Exception("SendInput was blocked (is an elevated window focused?)");}
 static INPUT Mouse(uint flags,uint data){var i=new INPUT();i.type=0;i.U.mi.dwFlags=flags;i.U.mi.mouseData=data;return i;}
 static INPUT Kb(ushort vk,ushort scan,uint flags){var i=new INPUT();i.type=1;i.U.ki.wVk=vk;i.U.ki.wScan=scan;i.U.ki.dwFlags=flags;return i;}
 public static void Move(int x,int y){if(!SetCursorPos(x,y))throw new Exception("SetCursorPos failed");}
 public static void Click(bool right,bool dbl){uint d=right?8u:2u,u=right?16u:4u;var l=new List<INPUT>();for(int n=0;n<(dbl?2:1);n++){l.Add(Mouse(d,0));l.Add(Mouse(u,0));}Send(l);}
 public static void Scroll(int delta){Send(new List<INPUT>{Mouse(0x0800,unchecked((uint)delta))});}
 public static void Type(string s){var l=new List<INPUT>();foreach(char ch in s){if(ch=='\r')continue;if(ch=='\n'){l.Add(Kb(13,0,0));l.Add(Kb(13,0,2));continue;}l.Add(Kb(0,ch,4));l.Add(Kb(0,ch,6));}Send(l);}
 static readonly Dictionary<string,ushort> V=new Dictionary<string,ushort>{{"ENTER",13},{"TAB",9},{"ESC",27},{"ESCAPE",27},{"BACKSPACE",8},{"DELETE",46},{"SPACE",32},{"UP",38},{"DOWN",40},{"LEFT",37},{"RIGHT",39},{"HOME",36},{"END",35},{"PAGEUP",33},{"PAGEDOWN",34},{"SHIFT",16},{"CTRL",17},{"ALT",18},{"META",91},{"WIN",91},{"F1",112},{"F2",113},{"F3",114},{"F4",115},{"F5",116},{"F6",117},{"F7",118},{"F8",119},{"F9",120},{"F10",121},{"F11",122},{"F12",123}};
 public static void Keys(string combo){var parts=combo.Split('+');var codes=new List<ushort>();foreach(var p in parts){ushort c;if(V.TryGetValue(p,out c))codes.Add(c);else if(p.Length==1)codes.Add((ushort)Char.ToUpperInvariant(p[0]));else throw new Exception("Unsupported key "+p);}
  var l=new List<INPUT>();foreach(var c in codes)l.Add(Kb(c,0,0));for(int i=codes.Count-1;i>=0;i--)l.Add(Kb(codes[i],0,2));Send(l);}
 public static string Shot(int maxWidth,long quality){var b=Screen.PrimaryScreen.Bounds;using(var full=new Bitmap(b.Width,b.Height)){using(var g=Graphics.FromImage(full)){g.CopyFromScreen(b.Location,Point.Empty,b.Size);}
  Bitmap img=full;bool scaled=false;if(maxWidth>0&&b.Width>maxWidth){int h=(int)Math.Round((double)b.Height*maxWidth/b.Width);img=new Bitmap(full,new Size(maxWidth,h));scaled=true;}
  try{ImageCodecInfo jpg=null;foreach(var c in ImageCodecInfo.GetImageEncoders())if(c.MimeType=="image/jpeg")jpg=c;var ps=new EncoderParameters(1);ps.Param[0]=new EncoderParameter(System.Drawing.Imaging.Encoder.Quality,quality);
   using(var s=new MemoryStream()){img.Save(s,jpg,ps);return Convert.ToBase64String(s.ToArray())+"|"+b.Width+"x"+b.Height;}}finally{if(scaled)img.Dispose();}}}
}`;

/**
 * UI Automation (the Windows accessibility tree). Gives the model a numbered list of the real buttons,
 * fields and links in the foreground window (name, type, position), so small local models act on
 * named elements instead of guessing pixel coordinates from a screenshot. Password fields never
 * expose their value. Compiled separately: if UI Automation is unavailable, mouse/keyboard still work.
 * C# 5 only (Windows PowerShell 5.1 compiler).
 */
const WIN_UIA_CS=String.raw`
using System;using System.Collections.Generic;using System.Text;using System.Diagnostics;using System.Runtime.InteropServices;using System.Windows.Automation;
public static class LxUia{
 [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h,int cmd);
 [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
 static List<AutomationElement> last=new List<AutomationElement>();
 static List<string> lastJson=new List<string>();
 static string Esc(string s){if(s==null)return "";var b=new StringBuilder();foreach(char c in s){if(c=='"')b.Append("\\\"");else if(c=='\\')b.Append("\\\\");else if(c=='\n')b.Append("\\n");else if(c<32)b.Append(' ');else b.Append(c);}return b.ToString();}
 static string Cut(string s,int n){if(s==null)return "";s=s.Trim();return s.Length>n?s.Substring(0,n):s;}
 static bool Interactive(ControlType t){return t==ControlType.Button||t==ControlType.Edit||t==ControlType.ComboBox||t==ControlType.CheckBox||t==ControlType.RadioButton||t==ControlType.Hyperlink||t==ControlType.ListItem||t==ControlType.MenuItem||t==ControlType.TabItem||t==ControlType.TreeItem||t==ControlType.SplitButton||t==ControlType.Slider||t==ControlType.Spinner||t==ControlType.DataItem||t==ControlType.Document;}
 static string TypeName(ControlType t){string n=t.ProgrammaticName;int i=n.LastIndexOf('.');return i>=0?n.Substring(i+1):n;}
 static string Describe(AutomationElement e,int index){
  var c=e.Current;var r=c.BoundingRectangle;var sb=new StringBuilder();
  sb.Append("{\"i\":").Append(index).Append(",\"type\":\"").Append(TypeName(c.ControlType)).Append("\",\"name\":\"").Append(Esc(Cut(c.Name,120))).Append("\"");
  if(!string.IsNullOrEmpty(c.AutomationId))sb.Append(",\"id\":\"").Append(Esc(Cut(c.AutomationId,80))).Append("\"");
  sb.Append(",\"rect\":[").Append((int)r.X).Append(',').Append((int)r.Y).Append(',').Append((int)r.Width).Append(',').Append((int)r.Height).Append(']');
  if(!c.IsEnabled)sb.Append(",\"enabled\":false");
  if(c.HasKeyboardFocus)sb.Append(",\"focused\":true");
  if(c.IsPassword)sb.Append(",\"password\":true");
  else if(c.ControlType==ControlType.Edit||c.ControlType==ControlType.ComboBox||c.ControlType==ControlType.Document){object p;if(e.TryGetCurrentPattern(ValuePattern.Pattern,out p)){string v=((ValuePattern)p).Current.Value;if(!string.IsNullOrEmpty(v))sb.Append(",\"value\":\"").Append(Esc(Cut(v,200))).Append("\"");}}
  object tp;if(e.TryGetCurrentPattern(TogglePattern.Pattern,out tp))sb.Append(",\"checked\":").Append(((TogglePattern)tp).Current.ToggleState==ToggleState.On?"true":"false");
  sb.Append('}');return sb.ToString();
 }
 static void Walk(AutomationElement e,int depth,int max,Stopwatch sw,ref bool truncated){
  if(depth>30||last.Count>=max||sw.ElapsedMilliseconds>5000){truncated=true;return;}
  var walker=TreeWalker.ControlViewWalker;AutomationElement child=null;
  try{child=walker.GetFirstChild(e);}catch(Exception){return;}
  while(child!=null){
   if(last.Count>=max||sw.ElapsedMilliseconds>5000){truncated=true;return;}
   try{var c=child.Current;var t=c.ControlType;if(!c.IsOffscreen&&Interactive(t)&&!c.BoundingRectangle.IsEmpty&&c.BoundingRectangle.Width>0&&(c.Name.Length>0||t==ControlType.Edit||t==ControlType.ComboBox||t==ControlType.Document)){lastJson.Add(Describe(child,last.Count));last.Add(child);}}catch(Exception){}
   Walk(child,depth+1,max,sw,ref truncated);
   try{child=walker.GetNextSibling(child);}catch(Exception){child=null;}
  }
 }
 public static string Windows(){
  var sb=new StringBuilder("{\"windows\":[");bool first=true;
  var all=AutomationElement.RootElement.FindAll(TreeScope.Children,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Window));
  foreach(AutomationElement w in all){string n;int pid;try{n=w.Current.Name;pid=w.Current.ProcessId;}catch(Exception){continue;}if(string.IsNullOrEmpty(n))continue;if(!first)sb.Append(',');first=false;sb.Append("{\"title\":\"").Append(Esc(Cut(n,160))).Append("\",\"pid\":").Append(pid).Append('}');}
  return sb.Append("]}").ToString();
 }
 public static string Tree(int max){
  if(max<=0||max>400)max=120;
  last=new List<AutomationElement>();lastJson=new List<string>();
  IntPtr fg=GetForegroundWindow();if(fg==IntPtr.Zero)throw new Exception("No foreground window.");
  var root=AutomationElement.FromHandle(fg);string title="";try{title=root.Current.Name;}catch(Exception){}
  bool truncated=false;var sw=Stopwatch.StartNew();Walk(root,0,max,sw,ref truncated);
  var sb=new StringBuilder("{\"window\":\"").Append(Esc(Cut(title,160))).Append("\",\"truncated\":").Append(truncated?"true":"false").Append(",\"elements\":[");
  for(int i=0;i<lastJson.Count;i++){if(i>0)sb.Append(',');sb.Append(lastJson[i]);}
  return sb.Append("]}").ToString();
 }
 static AutomationElement Get(int i){if(i<0||i>=last.Count)throw new Exception("Unknown element index "+i+"; take a new ui tree first.");return last[i];}
 /** Returns "mouse|x|y" when the caller should click the centre with the real mouse, otherwise the pattern used. */
 public static string Click(int i,bool pattern){
  var e=Get(i);System.Windows.Rect r;
  try{r=e.Current.BoundingRectangle;}catch(ElementNotAvailableException){throw new Exception("The element is gone; take a new ui tree.");}
  if(!pattern&&!r.IsEmpty&&r.Width>0&&r.Height>0)return "mouse|"+(int)(r.X+r.Width/2)+"|"+(int)(r.Y+r.Height/2);
  object p;
  if(e.TryGetCurrentPattern(InvokePattern.Pattern,out p)){((InvokePattern)p).Invoke();return "invoke";}
  if(e.TryGetCurrentPattern(TogglePattern.Pattern,out p)){((TogglePattern)p).Toggle();return "toggle";}
  if(e.TryGetCurrentPattern(SelectionItemPattern.Pattern,out p)){((SelectionItemPattern)p).Select();return "select";}
  if(e.TryGetCurrentPattern(ExpandCollapsePattern.Pattern,out p)){var ec=(ExpandCollapsePattern)p;if(ec.Current.ExpandCollapseState==ExpandCollapseState.Collapsed)ec.Expand();else ec.Collapse();return "expand";}
  throw new Exception("The element cannot be clicked; take a new ui tree.");
 }
 /** "value" when set through the Value pattern; "focus" when the caller must select-all and type. */
 public static string SetText(int i,string text){
  var e=Get(i);object p;
  if(e.TryGetCurrentPattern(ValuePattern.Pattern,out p)&&!((ValuePattern)p).Current.IsReadOnly){((ValuePattern)p).SetValue(text);return "value";}
  e.SetFocus();return "focus";
 }
 public static string Focus(string title){
  if(string.IsNullOrEmpty(title))throw new Exception("title is required.");
  var all=AutomationElement.RootElement.FindAll(TreeScope.Children,new PropertyCondition(AutomationElement.ControlTypeProperty,ControlType.Window));
  foreach(AutomationElement w in all){string n;int h;try{n=w.Current.Name;h=w.Current.NativeWindowHandle;}catch(Exception){continue;}
   if(n!=null&&h!=0&&n.IndexOf(title,StringComparison.OrdinalIgnoreCase)>=0){var hw=new IntPtr(h);if(IsIconic(hw))ShowWindow(hw,9);if(!SetForegroundWindow(hw))return "retry|"+h+"|"+Esc(Cut(n,160));return "ok|"+h+"|"+Esc(Cut(n,160));}}
  throw new Exception("No open window title contains: "+title);
 }
 public static bool Retry(int h){return SetForegroundWindow(new IntPtr(h));}
}`;
const WIN_HELPER_PS=[
 "$ErrorActionPreference='Stop'",
 "[Console]::OutputEncoding=[Text.Encoding]::UTF8",
 // The C# sources arrive as the first two stdin lines: embedding them in -EncodedCommand
 // exceeded Windows' 32,767-character command-line limit (spawn ENAMETOOLONG).
 "$deskSrc=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))",
 "$uiaSrc=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadLine()))",
 "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
 "Add-Type -TypeDefinition $deskSrc -ReferencedAssemblies System.Windows.Forms,System.Drawing",
 "[LxDesk]::SetProcessDPIAware()|Out-Null",
 "$uiaError=''",
 "try{Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes,WindowsBase;$uiaRefs=@([System.Windows.Automation.AutomationElement].Assembly.Location,[System.Windows.Automation.ControlType].Assembly.Location,[System.Windows.Rect].Assembly.Location);Add-Type -TypeDefinition $uiaSrc -ReferencedAssemblies $uiaRefs}catch{$uiaError=$_.Exception.Message}",
 "function Need-Uia{if($uiaError){throw ('UI Automation is unavailable: '+$uiaError)}}",
 "[Console]::Out.WriteLine('{\"ready\":true}')",
 "while(($line=[Console]::In.ReadLine()) -ne $null){",
 " $id=$null",
 " try{",
 "  $r=ConvertFrom-Json $line;$id=$r.id",
 "  $out=switch([string]$r.op){",
 "   'move'{[LxDesk]::Move([int]$r.x,[int]$r.y);'ok'}",
 "   'click'{[LxDesk]::Move([int]$r.x,[int]$r.y);[LxDesk]::Click([bool]$r.right,[bool]$r.double);'ok'}",
 "   'scroll'{[LxDesk]::Scroll([int]$r.delta);'ok'}",
 "   'type'{[LxDesk]::Type([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$r.text)));'ok'}",
 "   'key'{[LxDesk]::Keys([string]$r.key);'ok'}",
 "   'shot'{[LxDesk]::Shot([int]$r.maxWidth,[long]$r.quality)}",
 "   'uitree'{Need-Uia;if([string]$r.scope -eq 'windows'){[LxUia]::Windows()}else{[LxUia]::Tree([int]$r.max)}}",
 "   'uiclick'{Need-Uia;$res=[LxUia]::Click([int]$r.index,[bool]$r.pattern);if($res.StartsWith('mouse|')){$p=$res.Split('|');[LxDesk]::Move([int]$p[1],[int]$p[2]);[LxDesk]::Click([bool]$r.right,[bool]$r.double)};$res}",
 "   'uiset'{Need-Uia;$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$r.text));$res=[LxUia]::SetText([int]$r.index,$t);if($res -eq 'focus'){[LxDesk]::Keys('CTRL+A');[LxDesk]::Type($t)};$res}",
 "   'focuswin'{Need-Uia;$res=[LxUia]::Focus([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([string]$r.title)));if($res.StartsWith('retry|')){$p=$res.Split('|');[LxDesk]::Keys('ALT');Start-Sleep -Milliseconds 50;if(-not [LxUia]::Retry([int]$p[1])){throw 'Windows refused to bring that window to the front.'};$res='ok|'+$p[1]+'|'+$p[2]};$res}",
 "   'ping'{'ok'}",
 "   default{throw 'unknown operation'}",
 "  }",
 "  [Console]::Out.WriteLine((@{id=$id;ok=$true;data=[string]$out}|ConvertTo-Json -Compress))",
 " }catch{[Console]::Out.WriteLine((@{id=$id;ok=$false;error=$_.Exception.Message}|ConvertTo-Json -Compress))}",
 "}"
].join("\n");

/** Length of the -EncodedCommand argument; Windows rejects command lines over 32,767 characters. */
export function windowsHelperCommandChars():number{return Buffer.from(WIN_HELPER_PS,"utf16le").toString("base64").length;}

export interface WindowsDesktopBackend{send(op:Record<string,unknown>,timeoutMs?:number):Promise<string>}

class PowerShellDesktopHelper implements WindowsDesktopBackend{
 private child:ChildProcessWithoutNullStreams|null=null;
 private ready:Promise<void>|null=null;
 private readonly pending=new Map<string,{resolve:(v:string)=>void;reject:(e:Error)=>void;timer:NodeJS.Timeout}>();
 private stderr="";
 private start():Promise<void>{
  if(this.ready)return this.ready;
  this.ready=new Promise((resolve,reject)=>{
   const root=process.env.SystemRoot??process.env.SYSTEMROOT??"C:\\Windows";
   const exe=win32.join(root,"System32","WindowsPowerShell","v1.0","powershell.exe");
   // -InputFormat None: PowerShell must not treat redirected stdin as pipeline input, or it competes
   // with the helper's own [Console]::In reads (the classic "PowerShell hangs with redirected stdin").
   const child=spawn(existsSync(exe)?exe:"powershell.exe",["-NoLogo","-NoProfile","-NonInteractive","-ExecutionPolicy","Bypass","-InputFormat","None","-EncodedCommand",Buffer.from(WIN_HELPER_PS,"utf16le").toString("base64")],
    {shell:false,windowsHide:true,stdio:["pipe","pipe","pipe"],env:safeChildEnv()});
   this.child=child;
   child.stdin.on("error",()=>undefined);
   child.stdin.write(Buffer.from(WIN_HELPER_CS,"utf8").toString("base64")+"\n"+Buffer.from(WIN_UIA_CS,"utf8").toString("base64")+"\n");
   // First start compiles two C# helpers and loads UI Automation: a cold Windows (or CI runner) can need a minute.
   const startup=setTimeout(()=>{reject(new Error("Desktop helper did not start within 120 s: "+this.stderr.slice(0,300)));try{child.kill();}catch{}this.reset();},120_000);
   child.stderr.setEncoding("utf8").on("data",(c:string)=>{this.stderr=(this.stderr+c).slice(-4000);});
   createInterface({input:child.stdout}).on("line",line=>{
    let msg:{ready?:boolean;id?:string;ok?:boolean;data?:string;error?:string};
    try{msg=JSON.parse(line.replace(/^\uFEFF/,""));}catch{return;}
    if(msg.ready){clearTimeout(startup);resolve();return;}
    const p=msg.id?this.pending.get(msg.id):undefined;
    if(!p)return;
    this.pending.delete(msg.id!);clearTimeout(p.timer);
    if(msg.ok)p.resolve(String(msg.data??""));else p.reject(new Error(msg.error||"Desktop action failed."));
   });
   child.on("exit",()=>{clearTimeout(startup);for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error("Desktop helper stopped: "+this.stderr.slice(0,300)));}this.pending.clear();this.reset();});
   child.on("error",error=>{clearTimeout(startup);reject(error);this.reset();});
  });
  return this.ready;
 }
 private reset(){this.child=null;this.ready=null;}
 async send(op:Record<string,unknown>,timeoutMs=8000):Promise<string>{
  await this.start();
  const id=randomUUID();
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error("Desktop action timed out."));},timeoutMs);
   this.pending.set(id,{resolve,reject,timer});
   this.child!.stdin.write(JSON.stringify({...op,id})+"\n");
  });
 }
}

/** Test seam: route Windows operations through a plain runner (one call per action). */
function runnerBackend(run:Runner):WindowsDesktopBackend{
 return{async send(op,timeoutMs){const r=await run("powershell.exe",["layanx-desktop",String(op.op),JSON.stringify(op)],timeoutMs);if(r.code!==0)throw new Error(r.stderr||"Windows desktop operation failed.");return r.stdout.trim();}};
}

let sharedHelper:PowerShellDesktopHelper|null=null;

/**
 * Start the Windows helper in the background a few seconds after LayanX starts, so the first
 * computer-use action does not wait for C# compilation. LAYANX_DESKTOP_PREWARM=off disables it.
 */
export function prewarmDesktopHelper(env:NodeJS.ProcessEnv=process.env):void{
 if(process.platform!=="win32"||env.LAYANX_DESKTOP_PREWARM==="off")return;
 const timer=setTimeout(()=>{(sharedHelper??=new PowerShellDesktopHelper()).send({op:"ping"},120_000).catch(()=>undefined);},5000);
 timer.unref();
}

export function createDesktopControlToolAdapter(options:{runner?:Runner;windows?:WindowsDesktopBackend}={}):ToolAdapter{
 const run=options.runner??runner();
 const win=():WindowsDesktopBackend=>options.windows??(options.runner?runnerBackend(options.runner):(sharedHelper??=new PowerShellDesktopHelper()));
 return {async execute(request){
  const x=payload(request);
  if(request.action==="desktop status"){const platform=process.platform;const commands=platform==="win32"?["powershell.exe"]:platform==="darwin"?["osascript","screencapture"]:["xdotool","gnome-screenshot"];const available=commands.filter(c=>{try{execFileSync(platform==="win32"?"where":"which",[c],{stdio:"ignore",windowsHide:true});return true;}catch{return false;}});return {platform,ready:platform==="win32"?available.includes("powershell.exe"):platform==="linux"?available.includes("xdotool")&&available.includes("gnome-screenshot"):false,available,features:platform==="win32"?["mouse","double-click","scroll","unicode-typing","key-combinations","screenshot-jpeg","ui-automation-tree","click-element","set-element-text","focus-window"]:undefined};}
  if(request.action==="desktop move mouse"||request.action==="desktop click"){
   const px=numberValue(x.x,"x",20000),py=numberValue(x.y,"y",20000);const button=x.button==="right"?"right":"left";const dbl=x.double===true;
   if(process.platform==="win32"){await win().send({op:request.action==="desktop click"?"click":"move",x:px,y:py,right:button==="right",double:dbl});return {x:px,y:py,...(request.action==="desktop click"?{button,double:dbl}:{})};}
   if(process.platform==="darwin")throw new Error("macOS desktop control requires an accessibility adapter; install it before enabling desktop actions.");
   const args=request.action==="desktop click"?["mousemove",String(px),String(py),"click",...(dbl?["--repeat","2"]:[]),button==="right"?"3":"1"]:["mousemove",String(px),String(py)];
   const r=await run("xdotool",args);if(r.code!==0)throw new Error(r.stderr||"xdotool is required for Linux desktop control.");return {x:px,y:py,...(request.action==="desktop click"?{button,double:dbl}:{})};
  }
  if(request.action==="desktop scroll"){
   const amount=typeof x.amount==="number"&&Number.isInteger(x.amount)?Math.max(-20,Math.min(20,x.amount)):-3;
   if(process.platform==="win32"){await win().send({op:"scroll",delta:amount*120});return {amount};}
   const r=await run("xdotool",["click","--repeat",String(Math.abs(amount)),amount<0?"5":"4"]);if(r.code!==0)throw new Error(r.stderr||"xdotool is required for Linux scrolling.");return {amount};
  }
  if(request.action==="desktop type"){const value=textValue(x.text);
   if(process.platform==="win32"){await win().send({op:"type",text:Buffer.from(value,"utf8").toString("base64")},20_000);return {characters:value.length};}
   if(process.platform==="darwin")throw new Error("macOS desktop control requires an accessibility adapter; install it before enabling desktop actions.");
   const r=await run("xdotool",["type","--delay","0","--",value],15000);if(r.code!==0)throw new Error(r.stderr||"xdotool is required for Linux keyboard control.");return {characters:value.length};}
  if(request.action==="desktop press key"){const k=keyValue(x.key);
   if(process.platform==="win32"){await win().send({op:"key",key:k});return {key:k};}
   if(process.platform==="darwin")throw new Error("macOS desktop control requires an accessibility adapter; install it before enabling desktop actions.");
   const r=await run("xdotool",["key",k.toLowerCase().replace(/\bctrl\b/g,"ctrl").replace(/\bwin\b|\bmeta\b/g,"super")]);if(r.code!==0)throw new Error(r.stderr||"xdotool is required for Linux keyboard control.");return {key:k};}
  if(request.action==="desktop screenshot"){
   let data="",mimeType="image/png",screen:string|undefined;
   if(process.platform==="win32"){
    const maxWidth=typeof x.maxWidth==="number"&&Number.isInteger(x.maxWidth)?Math.max(320,Math.min(3840,x.maxWidth)):1920;
    const out=await win().send({op:"shot",maxWidth,quality:80},15_000);
    const [b64,size]=out.split("|");data=(b64??"").trim();if(size)screen=size;mimeType=options.runner?"image/png":"image/jpeg";
   }else{if(process.platform==="darwin")throw new Error("macOS screenshot is not enabled by this adapter.");const path=join(tmpdir(),"layanx-"+randomUUID()+".png");const r=await run("gnome-screenshot",["-f",path],15000);if(r.code!==0)throw new Error(r.stderr||"gnome-screenshot is required for Linux screenshots.");if(r.stdout.trim())data=r.stdout.trim();else{const bytes=await readFile(path);await unlink(path).catch(()=>{});if(bytes.length>MAX_SCREENSHOT_BYTES)throw new Error("Screenshot exceeds the 5 MiB limit.");data=bytes.toString("base64");}}
   const bytes=Buffer.from(data,"base64");if(!bytes.length)throw new Error("Screenshot is empty.");if(bytes.length>MAX_SCREENSHOT_BYTES)throw new Error("Screenshot exceeds the 5 MiB limit.");
   return {mimeType,base64:data,bytes:bytes.length,...(screen?{screen}:{})};
  }
  if(request.action==="desktop ui tree"){
   if(process.platform!=="win32")throw new Error("The UI Automation tree is available on Windows only; use desktop.screenshot here.");
   const scope=x.scope==="windows"?"windows":"window";
   const max=typeof x.maxElements==="number"&&Number.isInteger(x.maxElements)?Math.max(10,Math.min(400,x.maxElements)):120;
   const raw=await win().send({op:"uitree",scope,max},20_000);
   let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new Error("UI Automation returned an unreadable tree.");}
   return {...(parsed as Record<string,unknown>),...(scope==="window"?{hint:"Act with desktop.ui.click / desktop.ui.set_text using an element index 'i'. Indexes are valid until the next ui tree."}:{})};
  }
  if(request.action==="desktop click element"){
   if(process.platform!=="win32")throw new Error("Clicking UI elements by index is available on Windows only.");
   const index=numberValue(x.index,"index",399);
   const method=await win().send({op:"uiclick",index,pattern:x.pattern===true,right:x.button==="right",double:x.double===true});
   return {index,method:method.startsWith("mouse|")?"mouse":method};
  }
  if(request.action==="desktop set element text"){
   if(process.platform!=="win32")throw new Error("Setting text by element index is available on Windows only.");
   const index=numberValue(x.index,"index",399);const value=textValue(x.text);
   const method=await win().send({op:"uiset",index,text:Buffer.from(value,"utf8").toString("base64")},20_000);
   return {index,characters:value.length,method};
  }
  if(request.action==="desktop focus window"){
   if(process.platform!=="win32")throw new Error("Focusing windows by title is available on Windows only.");
   const title=typeof x.title==="string"?x.title.trim():"";
   if(!title||title.length>200)throw new Error("title must be 1-200 characters.");
   const out=await win().send({op:"focuswin",title:Buffer.from(title,"utf8").toString("base64")});
   const parts=out.split("|");
   return {focused:true,title:parts[2]??title};
  }
  throw new Error("Unsupported desktop control action.");
 }};
}
