<#
  LayanX desktop island: a small bar on top of every window that shows what LayanX is doing
  (the running mission, its stage and progress) and what is waiting for you (approvals).
  Started by LayanX itself (src/local/island.ts), which passes the access token on standard input.

  Click it: the control center opens (approvals are decided there or on the phone, never here).
  Drag it: move it. The x: hide it until LayanX starts again.

  -Once -Snapshot file.png : read the feed once, draw the island, save the picture and exit (tests).
#>
param([int]$Port = 3000, [string]$DataDir = '', [switch]$Once, [string]$Snapshot = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Net.Http

# One island per Windows session: a restarted LayanX finds the old one and leaves it.
$created = $false
$mutex = New-Object System.Threading.Mutex($true, 'Local\LayanXDesktopIsland', [ref]$created)
if (-not $created -and -not $Once) { exit 0 }

$token = [Console]::In.ReadLine()
if (-not $token) { Write-Output 'no token on standard input'; exit 2 }
$Base = "http://127.0.0.1:$Port"
$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(10)
$client.DefaultRequestHeaders.Authorization = New-Object System.Net.Http.Headers.AuthenticationHeaderValue('Bearer', $token)

$script:feed = $null
$script:online = $false
$script:lastOk = Get-Date
$script:expanded = $false
$script:pending = $null
$script:lastAsk = [DateTime]::MinValue

$C = @{
  Bg = [System.Drawing.Color]::FromArgb(242, 14, 20, 40)
  Line = [System.Drawing.Color]::FromArgb(255, 36, 48, 77)
  Ink = [System.Drawing.Color]::FromArgb(255, 238, 242, 250)
  Soft = [System.Drawing.Color]::FromArgb(255, 154, 166, 194)
  Purple = [System.Drawing.Color]::FromArgb(255, 139, 108, 255)
  Green = [System.Drawing.Color]::FromArgb(255, 34, 197, 94)
  Amber = [System.Drawing.Color]::FromArgb(255, 245, 158, 11)
  Rose = [System.Drawing.Color]::FromArgb(255, 239, 68, 68)
  Blue = [System.Drawing.Color]::FromArgb(255, 59, 130, 246)
}
$Status = @{ queued = 'في الانتظار'; planning = 'يخطط'; running = 'يعمل'; waiting_approval = 'ينتظر موافقتك'; verifying = 'تحقق نهائي'; completed = 'اكتملت'; failed = 'توقفت'; cancelled = 'أُلغيت'; budget_exhausted = 'انتهى الوقت' }
$Active = @('queued', 'planning', 'running', 'waiting_approval', 'verifying')
$FontMain = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
$FontSmall = New-Object System.Drawing.Font('Segoe UI', 9)
$Width = 380
$Collapsed = 40

function Approvals-Text([int]$n) {
  if ($n -eq 1) { return 'موافقة واحدة بانتظارك' }
  if ($n -eq 2) { return 'موافقتان بانتظارك' }
  return "$n موافقات بانتظارك"
}

# Everything the island shows, from the same feed the phone uses (/v1/companion/feed).
function Get-View {
  $f = $script:feed
  $v = @{ Dot = $C.Rose; Main = 'LayanX غير متصل'; Side = ''; Lines = @(); Progress = -1 }
  if (-not $script:online -or -not $f) { return $v }
  $approvals = @($f.approvals | Where-Object { $_ })
  $job = @($f.jobs | Where-Object { $_ -and ($Active -contains $_.status) }) | Select-Object -First 1
  if ($f.load) { $v.Side = "CPU $($f.load.cpu.percent)% · RAM $($f.load.memory.percent)%" }
  if ($approvals.Count -gt 0) { $v.Dot = $C.Amber; $v.Main = '⏸ ' + (Approvals-Text $approvals.Count) }
  elseif ($job) { $v.Dot = $C.Blue; $v.Main = "$($Status[$job.status]): $($job.stage)" }
  else { $v.Dot = $C.Green; $v.Main = 'LayanX جاهز' }
  if ($job) {
    $v.Lines += "$($job.goal)"
    if ($job.total -gt 0) { $v.Lines += "$($job.done)/$($job.total) مراحل · $($Status[$job.status])"; $v.Progress = [double]$job.done / [double]$job.total }
  }
  foreach ($a in ($approvals | Select-Object -First 3)) { $v.Lines += "⏸ $($a.tool) — $($a.projectId)" }
  if ($f.scalper) {
    $s = if ($f.scalper.running) { 'السكالبر يعمل' } else { 'السكالبر متوقف' }
    if ($null -ne $f.scalper.tradesToday) { $s += " · صفقات اليوم $($f.scalper.tradesToday)" }
    $v.Lines += $s
  }
  if ($v.Lines.Count -gt 0) { $v.Lines += 'انقر لفتح لوحة التحكم' }
  return $v
}

function Get-Height($view) {
  if (-not $script:expanded -or $view.Lines.Count -eq 0) { return $Collapsed }
  $h = $Collapsed + 6 + 20 * $view.Lines.Count
  if ($view.Progress -ge 0) { $h += 10 }
  return $h + 8
}

function Draw([System.Drawing.Graphics]$g, [int]$w, [int]$h, $view) {
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
  $g.Clear($C.Bg)
  $path = Rounded 0 0 ($w - 1) ($h - 1) 18
  $g.FillPath((New-Object System.Drawing.SolidBrush($C.Bg)), $path)
  $g.DrawPath((New-Object System.Drawing.Pen($C.Line)), $path)
  # right side (RTL): status dot, then the main line; left side: CPU/RAM and the x
  $g.FillEllipse((New-Object System.Drawing.SolidBrush($view.Dot)), $w - 24, 15, 10, 10)
  $rtl = [System.Windows.Forms.TextFormatFlags]::Right -bor [System.Windows.Forms.TextFormatFlags]::RightToLeft -bor [System.Windows.Forms.TextFormatFlags]::EndEllipsis -bor [System.Windows.Forms.TextFormatFlags]::VerticalCenter -bor [System.Windows.Forms.TextFormatFlags]::SingleLine
  $ltr = [System.Windows.Forms.TextFormatFlags]::Left -bor [System.Windows.Forms.TextFormatFlags]::VerticalCenter -bor [System.Windows.Forms.TextFormatFlags]::SingleLine
  $sideW = if ($view.Side) { 132 } else { 0 }
  [System.Windows.Forms.TextRenderer]::DrawText($g, $view.Main, $FontMain, ([System.Drawing.Rectangle]::new((30 + $sideW), 0, ($w - 62 - $sideW), $Collapsed)), $C.Ink, $rtl)
  if ($view.Side) { [System.Windows.Forms.TextRenderer]::DrawText($g, $view.Side, $FontSmall, ([System.Drawing.Rectangle]::new(28, 0, $sideW, $Collapsed)), $C.Soft, $ltr) }
  [System.Windows.Forms.TextRenderer]::DrawText($g, '×', $FontMain, ([System.Drawing.Rectangle]::new(8, 0, 18, $Collapsed)), $C.Soft, $ltr)
  if ($h -le $Collapsed) { return }
  $y = $Collapsed + 2
  if ($view.Progress -ge 0) {
    $g.FillRectangle((New-Object System.Drawing.SolidBrush($C.Line)), 16, $y, $w - 32, 5)
    $g.FillRectangle((New-Object System.Drawing.SolidBrush($C.Purple)), [int](16 + ($w - 32) * (1 - $view.Progress)), $y, [int](($w - 32) * $view.Progress), 5)
    $y += 10
  }
  foreach ($line in $view.Lines) {
    [System.Windows.Forms.TextRenderer]::DrawText($g, $line, $FontSmall, ([System.Drawing.Rectangle]::new(16, $y, $w - 32, 20)), $C.Soft, $rtl)
    $y += 20
  }
}

function Rounded([int]$x, [int]$y, [int]$w, [int]$h, [int]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

function Set-Feed([string]$json) {
  $script:feed = $json | ConvertFrom-Json
  $script:online = $true
  $script:lastOk = Get-Date
}

# ---------------------------------------------------------------- test mode
if ($Once) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  try { Set-Feed ($client.GetStringAsync("$Base/v1/companion/feed").Result) } catch { $script:online = $false }
  $script:expanded = $true
  $view = Get-View
  $h = Get-Height $view
  $bmp = New-Object System.Drawing.Bitmap($Width, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  Draw $g $Width $h $view
  $g.Dispose()
  if ($Snapshot) { $bmp.Save($Snapshot, [System.Drawing.Imaging.ImageFormat]::Png) }
  Write-Output (@{ online = $script:online; main = $view.Main; side = $view.Side; lines = $view.Lines.Count; height = $h } | ConvertTo-Json -Compress)
  exit 0
}

# ---------------------------------------------------------------- the window
try { Add-Type -Name Dpi -Namespace LayanX -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'; [LayanX.Dpi]::SetProcessDPIAware() | Out-Null } catch {}
[System.Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.StartPosition = 'Manual'
$form.BackColor = [System.Drawing.Color]::FromArgb(255, 14, 20, 40)
$form.Text = 'LayanX'
$form.Width = $Width
$form.Height = $Collapsed
$area = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$form.Location = [System.Drawing.Point]::new(($area.Left + [int](($area.Width - $Width) / 2)), ($area.Top + 8))
$prop = $form.GetType().GetProperty('DoubleBuffered', [System.Reflection.BindingFlags]'NonPublic,Instance')
$prop.SetValue($form, $true, $null)

$script:drag = $null
$script:moved = $false

function Refresh-Island {
  $view = Get-View
  $h = Get-Height $view
  if ($form.Height -ne $h) { $form.Height = $h }
  $form.Region = New-Object System.Drawing.Region((Rounded 0 0 $form.Width $form.Height 18))
  $form.Invalidate()
}

function Open-ControlCenter {
  try {
    $client.PostAsync("$Base/v1/setup/launch-ticket", (New-Object System.Net.Http.StringContent('{}', [System.Text.Encoding]::UTF8, 'application/json'))).Result | Out-Null
    $ticket = Get-Content (Join-Path $DataDir 'launch-ticket.json') -Raw | ConvertFrom-Json
    Start-Process "$Base/setup#launch=$($ticket.code)&next=%2F"
  } catch { Start-Process "$Base/" }
}

$form.Add_Paint({ param($s, $e) Draw $e.Graphics $form.Width $form.Height (Get-View) })
$form.Add_MouseEnter({ $script:expanded = $true; Refresh-Island })
$form.Add_MouseLeave({
  $p = $form.PointToClient([System.Windows.Forms.Cursor]::Position)
  if (-not $form.ClientRectangle.Contains($p)) { $script:expanded = $false; Refresh-Island }
})
$form.Add_MouseDown({ param($s, $e) if ($e.Button -eq 'Left') { $script:drag = $e.Location; $script:moved = $false } })
$form.Add_MouseMove({ param($s, $e)
  if ($script:drag -and $e.Button -eq 'Left') {
    $dx = $e.X - $script:drag.X; $dy = $e.Y - $script:drag.Y
    if ([Math]::Abs($dx) + [Math]::Abs($dy) -gt 3) { $script:moved = $true }
    if ($script:moved) { $form.Location = [System.Drawing.Point]::new(($form.Left + $dx), ($form.Top + $dy)) }
  }
})
$form.Add_MouseUp({ param($s, $e)
  $wasDrag = $script:moved; $script:drag = $null; $script:moved = $false
  if ($wasDrag -or $e.Button -ne 'Left') { return }
  if ($e.X -lt 28 -and $e.Y -lt $Collapsed) { $form.Close(); return }
  Open-ControlCenter
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 1000
$timer.Add_Tick({
  if ($script:pending) {
    if (-not $script:pending.IsCompleted) { return }
    try { Set-Feed $script:pending.Result } catch { $script:online = $false }
    $script:pending = $null
    Refresh-Island
  }
  # LayanX stopped for good: the island goes too (the next start opens a new one).
  if (((Get-Date) - $script:lastOk).TotalMinutes -gt 3) { $form.Close(); return }
  if (((Get-Date) - $script:lastAsk).TotalSeconds -ge 3) {
    $script:lastAsk = Get-Date
    $script:pending = $client.GetStringAsync("$Base/v1/companion/feed")
  }
})
$form.Add_Shown({ Refresh-Island; $timer.Start() })
$form.Add_FormClosed({ $timer.Stop(); try { $mutex.ReleaseMutex() } catch {} })
[System.Windows.Forms.Application]::Run($form)
