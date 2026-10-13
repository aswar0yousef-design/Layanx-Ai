import fs from "node:fs";
import path from "node:path";
import {spawn,type ChildProcess} from "node:child_process";
import {ensureCompiled} from "../platform/csharp.js";
import {writeFileAtomic} from "../platform/paths.js";
import {safeChildEnv} from "../platform/safe-env.js";

/**
 * Two small Windows programs, compiled on the PC from the C# below (C# 5, .NET Framework 4):
 *
 *  - layanx-hook.exe: the hook command Claude Code and Codex run. It forwards the event to LayanX on
 *    this PC (loopback, with the token in hook.json next to it) and prints what LayanX answers. When
 *    LayanX is not running it exits at once with nothing printed, so the agent is never held up.
 *  - layanx-island.exe: the status window at the top of the screen (jobs, approvals, coding agents,
 *    PC load). It reads only /v1/companion with a token LayanX hands it on stdin.
 *
 * Both have fixed paths under the data folder (bin\), because settings.json points at the relay.
 */
export const HOOK_RELAY_CS=String.raw`using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;

static class LayanXHook {
  static int Main(string[] args) {
    try {
      string agent = args.Length > 0 ? args[0] : "claude";
      if (!Regex.IsMatch(agent, "^[a-z]{1,20}$")) return 0;
      MemoryStream input = new MemoryStream();
      Console.OpenStandardInput().CopyTo(input);
      byte[] payload = input.ToArray();
      if (payload.Length == 0 || payload.Length > 1048576) return 0;
      string config = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "..", "hook.json");
      if (!File.Exists(config)) return 0;
      string cfg = File.ReadAllText(config, Encoding.UTF8);
      Match port = Regex.Match(cfg, "\"port\"\\s*:\\s*(\\d{1,5})");
      Match token = Regex.Match(cfg, "\"token\"\\s*:\\s*\"([A-Za-z0-9_-]{16,200})\"");
      if (!port.Success || !token.Success) return 0;
      bool waits = Regex.IsMatch(Encoding.UTF8.GetString(payload), "\"hook_event_name\"\\s*:\\s*\"PermissionRequest\"");
      HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port.Groups[1].Value + "/v1/agents/hook?agent=" + agent);
      req.Method = "POST";
      req.ContentType = "application/json";
      req.Headers["x-layanx-hook-token"] = token.Groups[1].Value;
      req.Proxy = null;
      req.Timeout = waits ? 115000 : 5000;
      req.ReadWriteTimeout = req.Timeout;
      req.ContentLength = payload.Length;
      using (Stream s = req.GetRequestStream()) s.Write(payload, 0, payload.Length);
      using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) {
        if ((int)resp.StatusCode != 200) return 0;
        MemoryStream output = new MemoryStream();
        using (Stream rs = resp.GetResponseStream()) rs.CopyTo(output);
        byte[] o = output.ToArray();
        if (o.Length > 0) { Stream so = Console.OpenStandardOutput(); so.Write(o, 0, o.Length); so.Flush(); }
      }
    } catch { }
    // Never a failure code: a hook problem must not block the agent.
    return 0;
  }
}
`;

export const ISLAND_CS=String.raw`using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Media;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class IslandProgram {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [STAThread]
  static int Main(string[] args) {
    try { SetProcessDPIAware(); } catch { }
    Application.EnableVisualStyles();
    int port = 0; string selftest = null, feedFile = null; bool once = false;
    for (int i = 0; i < args.Length; i++) {
      if (args[i] == "--port" && i + 1 < args.Length) port = int.Parse(args[++i]);
      else if (args[i] == "--selftest" && i + 1 < args.Length) selftest = args[++i];
      else if (args[i] == "--feed" && i + 1 < args.Length) feedFile = args[++i];
      else if (args[i] == "--once") once = true;
    }
    if (selftest != null) {
      Island f = new Island(0, "");
      f.Apply((Dictionary<string, object>)new JavaScriptSerializer().DeserializeObject(File.ReadAllText(feedFile, Encoding.UTF8)));
      f.SetExpanded(true);
      f.Show();
      Application.DoEvents();
      using (Bitmap b = new Bitmap(f.Width, f.Height)) { f.DrawToBitmap(b, new Rectangle(0, 0, f.Width, f.Height)); b.Save(selftest); }
      Console.WriteLine("rendered " + f.Width + "x" + f.Height + " " + f.Summary);
      return 0;
    }
    string token = Console.In.ReadLine();
    if (string.IsNullOrEmpty(token) || port <= 0) return 2;
    if (once) {
      Island f = new Island(port, token);
      string err;
      Dictionary<string, object> feed = f.Fetch(null, 0, out err);
      if (feed == null) { Console.WriteLine("error " + err); return 1; }
      f.Apply(feed);
      Console.WriteLine("ok " + f.Summary);
      return 0;
    }
    Island island = new Island(port, token);
    // LayanX keeps our stdin open; when LayanX stops, it closes and the island goes too.
    Thread watch = new Thread(delegate() { try { while (Console.In.ReadLine() != null) { } } catch { } try { island.BeginInvoke(new MethodInvoker(delegate { Application.Exit(); })); } catch { Environment.Exit(0); } });
    watch.IsBackground = true;
    island.Start();
    watch.Start();
    Application.Run(island);
    return 0;
  }
}

class Island : Form {
  readonly int port; readonly string token;
  readonly Label pill = new Label();
  readonly FlowLayoutPanel list = new FlowLayoutPanel();
  readonly Panel dot = new Panel();
  bool expanded, hiddenByOwner;
  string version = "", lastApprovalIds = "";
  public string Summary = "";
  static readonly Color Bg = Color.FromArgb(24, 24, 32), Card = Color.FromArgb(38, 38, 50), Soft = Color.FromArgb(160, 160, 176);
  static readonly Color Green = Color.FromArgb(52, 199, 89), Blue = Color.FromArgb(10, 132, 255), Amber = Color.FromArgb(255, 159, 10), Grey = Color.FromArgb(120, 120, 130);

  public Island(int port, string token) {
    this.port = port; this.token = token;
    FormBorderStyle = FormBorderStyle.None; TopMost = true; ShowInTaskbar = false; StartPosition = FormStartPosition.Manual;
    BackColor = Bg; ForeColor = Color.White; Font = new Font("Segoe UI", 10f);
    RightToLeft = RightToLeft.Yes; RightToLeftLayout = true;
    Width = 420; Height = 38;
    dot.Size = new Size(10, 10); dot.Location = new Point(Width - 24, 14); dot.BackColor = Grey; dot.Anchor = AnchorStyles.Top | AnchorStyles.Right;
    pill.AutoSize = false; pill.Location = new Point(12, 0); pill.Size = new Size(Width - 44, 38); pill.TextAlign = ContentAlignment.MiddleRight; pill.Text = "LayanX";
    pill.Cursor = Cursors.Hand; pill.Click += delegate { SetExpanded(!expanded); };
    list.Location = new Point(8, 40); list.Size = new Size(Width - 16, 10); list.FlowDirection = FlowDirection.TopDown; list.WrapContents = false; list.AutoScroll = true; list.BackColor = Bg;
    Controls.Add(dot); Controls.Add(pill); Controls.Add(list);
    ContextMenu = new ContextMenu(new MenuItem[] {
      new MenuItem("فتح LayanX", delegate { OpenLayanX(); }),
      new MenuItem("إخفاء حتى الموافقة التالية", delegate { hiddenByOwner = true; Hide(); })
    });
    Place();
  }

  void Place() {
    Rectangle wa = Screen.PrimaryScreen.WorkingArea;
    Location = new Point(wa.Left + (wa.Width - Width) / 2, wa.Top + 6);
    using (GraphicsPath p = new GraphicsPath()) {
      int r = 18; Rectangle b = new Rectangle(0, 0, Width, Height);
      p.AddArc(b.X, b.Y, r, r, 180, 90); p.AddArc(b.Right - r, b.Y, r, r, 270, 90);
      p.AddArc(b.Right - r, b.Bottom - r, r, r, 0, 90); p.AddArc(b.X, b.Bottom - r, r, r, 90, 90); p.CloseFigure();
      Region = new Region(p);
    }
  }

  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams { get { CreateParams cp = base.CreateParams; cp.ExStyle |= 0x80 | 0x08000000; return cp; } } // tool window, no activate

  public void SetExpanded(bool on) {
    expanded = on;
    int content = 0; foreach (Control c in list.Controls) content += c.Height + c.Margin.Vertical;
    list.Height = on ? Math.Min(Math.Max(content, 30), 460) : 10;
    Height = on ? 46 + list.Height : 38;
    Place();
  }

  public void Start() {
    Thread t = new Thread(Loop); t.IsBackground = true; t.Start();
  }

  void Loop() {
    while (true) {
      string err;
      Dictionary<string, object> feed = Fetch(version, 25, out err);
      if (feed == null) {
        if (err == "401" || err == "403") { try { BeginInvoke(new MethodInvoker(delegate { Application.Exit(); })); } catch { } return; }
        try { BeginInvoke(new MethodInvoker(delegate { pill.Text = "LayanX غير متصل"; dot.BackColor = Grey; })); } catch { }
        Thread.Sleep(3000); continue;
      }
      try { BeginInvoke(new MethodInvoker(delegate { Apply(feed); })); } catch { return; }
    }
  }

  HttpWebRequest Request(string method, string path, int timeoutMs) {
    HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + path);
    req.Method = method; req.Proxy = null; req.Timeout = timeoutMs; req.ReadWriteTimeout = timeoutMs;
    req.Headers["Authorization"] = "Bearer " + token; req.Accept = "application/json";
    return req;
  }

  public Dictionary<string, object> Fetch(string since, int waitSeconds, out string error) {
    error = null;
    try {
      string path = "/v1/companion/feed?wait=" + waitSeconds + (string.IsNullOrEmpty(since) ? "" : "&since=" + Uri.EscapeDataString(since));
      HttpWebRequest req = Request("GET", path, (waitSeconds + 15) * 1000);
      using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
      using (StreamReader r = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
        return (Dictionary<string, object>)new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 }.DeserializeObject(r.ReadToEnd());
    } catch (WebException e) {
      HttpWebResponse r = e.Response as HttpWebResponse;
      error = r != null ? ((int)r.StatusCode).ToString() : e.Message;
      return null;
    } catch (Exception e) { error = e.Message; return null; }
  }

  bool Decide(string id, string digest, string decision) {
    try {
      HttpWebRequest req = Request("POST", "/v1/companion/decide", 30000);
      req.ContentType = "application/json";
      byte[] body = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(new Dictionary<string, object> { { "id", id }, { "digest", digest }, { "decision", decision } }));
      req.ContentLength = body.Length;
      using (Stream s = req.GetRequestStream()) s.Write(body, 0, body.Length);
      using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse()) return (int)resp.StatusCode == 200;
    } catch { return false; }
  }

  static string S(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) && v != null ? v.ToString() : ""; }
  static IEnumerable<Dictionary<string, object>> L(Dictionary<string, object> d, string k) {
    object v; if (d == null || !d.TryGetValue(k, out v) || v == null) yield break;
    IEnumerable e = v as IEnumerable; if (e == null) yield break;
    foreach (object o in e) { Dictionary<string, object> m = o as Dictionary<string, object>; if (m != null) yield return m; }
  }
  static string Agent(string a) { return a == "codex" ? "Codex" : "Claude Code"; }
  static string JobState(string s) {
    switch (s) { case "planning": return "يخطط"; case "queued": return "في الانتظار"; case "waiting_approval": return "ينتظر موافقتك"; case "verifying": return "تحقق نهائي";
      case "completed": return "اكتملت"; case "failed": return "توقفت"; case "cancelled": return "أُلغيت"; case "budget_exhausted": return "انتهت الميزانية"; default: return "يعمل"; }
  }
  static string SessionState(string s) { switch (s) { case "waiting": return "ينتظر موافقتك"; case "idle": return "انتهى من الرد"; case "ended": return "أُغلق"; default: return "يعمل"; } }

  // One Font per size (a new Font per label on every update would leak GDI handles).
  static readonly Dictionary<string, Font> fonts = new Dictionary<string, Font>();
  static Font FontOf(float size, bool bold) {
    string key = size + (bold ? "b" : "");
    Font f; if (!fonts.TryGetValue(key, out f)) { f = new Font("Segoe UI", size, bold ? FontStyle.Bold : FontStyle.Regular); fonts[key] = f; }
    return f;
  }
  static bool Flag(Dictionary<string, object> d, string k) { object v; return d != null && d.TryGetValue(k, out v) && v is bool && (bool)v; }
  static string Preview(string s, int n) { return s.Length <= n ? s : s.Substring(0, n) + " …"; }

  Label Text1(string text, Color color, float size, bool bold) {
    Label l = new Label(); l.AutoSize = false; l.Width = list.Width - 34; l.Text = text; l.ForeColor = color;
    l.Font = FontOf(size, bold); l.TextAlign = ContentAlignment.TopRight;
    using (Graphics g = CreateGraphics()) l.Height = (int)Math.Ceiling(g.MeasureString(text, l.Font, l.Width).Height) + 2;
    return l;
  }
  // Heights are set by hand (no AutoSize), so the island can size itself before it is laid out.
  Panel CardOf(params Control[] parts) {
    FlowLayoutPanel p = new FlowLayoutPanel(); p.FlowDirection = FlowDirection.TopDown; p.WrapContents = false;
    p.BackColor = Card; p.Padding = new Padding(8); p.Margin = new Padding(0, 0, 0, 6); p.Width = list.Width - 22;
    int h = p.Padding.Vertical;
    foreach (Control c in parts) { p.Controls.Add(c); h += c.Height + c.Margin.Vertical; }
    p.Height = h;
    return p;
  }
  static double D(Dictionary<string, object> d, string k) {
    object v; if (d == null || !d.TryGetValue(k, out v) || v == null) return 0;
    try { return Convert.ToDouble(v, System.Globalization.CultureInfo.InvariantCulture); } catch { return 0; }
  }
  static string Pct(Dictionary<string, object> d, string k) { return Math.Round(D(d, k)).ToString(System.Globalization.CultureInfo.InvariantCulture); }
  Button Btn(string text, Color back, Color fore) {
    Button b = new Button(); b.Text = text; b.BackColor = back; b.ForeColor = fore; b.FlatStyle = FlatStyle.Flat; b.Height = 30; b.Width = 90;
    return b;
  }

  public void Apply(Dictionary<string, object> feed) {
    version = S(feed, "v");
    List<Dictionary<string, object>> approvals = new List<Dictionary<string, object>>(L(feed, "approvals"));
    List<Dictionary<string, object>> jobs = new List<Dictionary<string, object>>(L(feed, "jobs"));
    List<Dictionary<string, object>> agents = new List<Dictionary<string, object>>(L(feed, "agents"));
    list.SuspendLayout();
    // Dispose what the last update drew (Clear alone would keep every window handle alive).
    while (list.Controls.Count > 0) { Control old = list.Controls[0]; list.Controls.Remove(old); old.Dispose(); }
    foreach (Dictionary<string, object> a in approvals) {
      string id = S(a, "id"), digest = S(a, "digest"), tool = S(a, "tool"), title = S(a, "title"), detail = S(a, "detail");
      bool full = Flag(a, "full");
      Button no = Btn("رفض", Bg, Color.White);
      FlowLayoutPanel buttons = new FlowLayoutPanel(); buttons.Width = list.Width - 34; buttons.Height = 36;
      if (full) {
        Button ok = Btn("موافقة", Amber, Color.Black);
        // The confirmation shows everything that will run, not the short preview on the card.
        ok.Click += delegate {
          if (MessageBox.Show(this, "الموافقة على: " + tool + "\n\n" + detail, "LayanX", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2, MessageBoxOptions.RtlReading | MessageBoxOptions.RightAlign) != DialogResult.Yes) return;
          ok.Enabled = no.Enabled = false; if (!Decide(id, digest, "approve")) MessageBox.Show(this, "لم تُسجَّل الموافقة (ربما أُجيب عليها من مكان آخر).", "LayanX");
        };
        no.Click += delegate { ok.Enabled = no.Enabled = false; Decide(id, digest, "deny"); };
        buttons.Controls.Add(ok);
      } else {
        // Too long to show here in full: review it in LayanX on this PC.
        Button review = Btn("مراجعة", Amber, Color.Black);
        review.Click += delegate { OpenLayanX(); };
        no.Click += delegate { review.Enabled = no.Enabled = false; Decide(id, digest, "deny"); };
        buttons.Controls.Add(review);
      }
      buttons.Controls.Add(no);
      list.Controls.Add(CardOf(Text1("⚠ " + title, Amber, 10f, true), Text1(tool + (detail.Length > 0 ? ": " + Preview(detail, 280) : ""), Color.White, 9.5f, false), buttons));
    }
    foreach (Dictionary<string, object> j in jobs) {
      Dictionary<string, object> m = null; object mo; if (j.TryGetValue("milestone", out mo)) m = mo as Dictionary<string, object>;
      string state = JobState(S(j, "status")) + (m != null ? " · المرحلة " + S(m, "index") + "/" + S(m, "total") + ": " + S(m, "title") : "");
      ProgressBar bar = new ProgressBar(); bar.Width = list.Width - 34; bar.Height = 6;
      bar.Value = Math.Max(0, Math.Min(100, (int)(D(j, "progress") * 100)));
      list.Controls.Add(CardOf(Text1(S(j, "goal"), Color.White, 10f, true), Text1(state, Soft, 9f, false), bar));
    }
    foreach (Dictionary<string, object> s in agents) {
      if (S(s, "status") == "ended") continue;
      string last = S(s, "lastTool") + (S(s, "lastDetail").Length > 0 ? ": " + S(s, "lastDetail") : "");
      list.Controls.Add(CardOf(Text1(Agent(S(s, "agent")) + " · " + S(s, "project"), Color.White, 10f, true), Text1(SessionState(S(s, "status")) + (last.Length > 0 ? " — " + last : ""), Soft, 9f, false)));
    }
    object pcObj; feed.TryGetValue("pc", out pcObj); Dictionary<string, object> pc = pcObj as Dictionary<string, object>;
    if (pc != null) list.Controls.Add(Text1("المعالج " + Pct(pc, "cpu") + "% · الذاكرة " + Pct(pc, "ram") + "%" + (S(pc, "gpu").Length > 0 ? " · الكرت " + Pct(pc, "gpu") + "%" : ""), Soft, 9f, false));
    list.ResumeLayout();

    int working = 0; foreach (Dictionary<string, object> j in jobs) { string st = S(j, "status"); if (st != "completed" && st != "failed" && st != "cancelled" && st != "budget_exhausted") working++; }
    foreach (Dictionary<string, object> s in agents) if (S(s, "status") == "working") working++;
    if (approvals.Count > 0) { pill.Text = approvals.Count + " بانتظار موافقتك · " + S(approvals[0], "title"); dot.BackColor = Amber; }
    else if (working > 0) {
      Dictionary<string, object> first = jobs.Count > 0 ? jobs[0] : null;
      pill.Text = first != null ? JobState(S(first, "status")) + ": " + S(first, "goal") : Agent(S(agents[0], "agent")) + " يعمل · " + S(agents[0], "project");
      dot.BackColor = Blue;
    } else { pill.Text = "LayanX جاهز"; dot.BackColor = Green; }
    Summary = "approvals=" + approvals.Count + " jobs=" + jobs.Count + " agents=" + agents.Count;

    // A new approval: show the island (even if hidden) and open it.
    StringBuilder ids = new StringBuilder(); foreach (Dictionary<string, object> a in approvals) ids.Append(S(a, "id")).Append(',');
    bool fresh = approvals.Count > 0 && ids.ToString() != lastApprovalIds && !lastApprovalIds.Contains(S(approvals[0], "id"));
    lastApprovalIds = ids.ToString();
    if (fresh) { hiddenByOwner = false; if (!Visible) Show(); SetExpanded(true); try { SystemSounds.Asterisk.Play(); } catch { } }
    else SetExpanded(expanded);
    if (hiddenByOwner && Visible) Hide();
  }

  void OpenLayanX() { try { System.Diagnostics.Process.Start("http://127.0.0.1:" + port + "/"); } catch { } }
}
`;

export const relayExe=(dataDir:string)=>path.join(dataDir,"bin","layanx-hook.exe");
export const islandExe=(dataDir:string)=>path.join(dataDir,"bin","layanx-island.exe");

export function ensureHookRelay(dataDir:string,env:NodeJS.ProcessEnv=process.env):Promise<string>{
  return ensureCompiled({source:HOOK_RELAY_CS,exe:relayExe(dataDir),env,what:"The coding-agent hook relay"});
}
export function ensureIsland(dataDir:string,env:NodeJS.ProcessEnv=process.env):Promise<string>{
  return ensureCompiled({source:ISLAND_CS,exe:islandExe(dataDir),target:"winexe",refs:["System.Windows.Forms.dll","System.Drawing.dll","System.Web.Extensions.dll"],env,what:"The screen-top island"});
}

/** Where the relay finds LayanX: written at every start (new port, new token), readable by this user only. */
export function writeHookConfig(dataDir:string,port:number,token:string){
  writeFileAtomic(path.join(dataDir,"hook.json"),JSON.stringify({port,token}));
  try{fs.chmodSync(path.join(dataDir,"hook.json"),0o600);}catch{}
}

/** Starts the island with its token on stdin; stdin stays open so the island closes when LayanX stops. */
export function startIsland(exe:string,port:number,token:string,log:(m:string)=>void):ChildProcess{
  // Its only key is the scoped token on stdin: no master token, no vault secrets in its environment.
  const child=spawn(exe,["--port",String(port)],{stdio:["pipe","ignore","ignore"],windowsHide:false,env:safeChildEnv()});
  child.stdin?.write(token+"\n");
  child.on("exit",code=>log(`island exited (${code})`));
  child.on("error",e=>log(`island: ${e.message}`));
  return child;
}
