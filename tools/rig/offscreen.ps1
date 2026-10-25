# offscreen.ps1 — keeps the rig's app windows off the screen for the length of a run, so a run
# no longer takes the machine away from whoever is using it. WINDOWS ONLY.
#
#   powershell -ExecutionPolicy Bypass -File offscreen.ps1 <marker> <seconds> <ready-file> <offence-log>
#
# run.js spawns ONE of these per run, before the first app, and kills it at the end.
#
# ⚠ ONE PER RUN, NOT ONE PER APP, AND THE READY FILE IS WHY. PowerShell needs about a second to
# start and compile the C# below, and a parker started after its app spends that second watching
# a window that is already on screen with focus. A regression launches one app per scenario, so
# that was one visible window and one stolen focus per scenario. This starts before any app,
# writes the ready file when it can actually move something, and run.js waits for that file.
#
# ⚠ IT MATCHES ON THE RUN'S OWN OUTPUT DIRECTORY, NEVER ON THE PROCESS NAME. Every profile the
# rig creates lives under that directory and it is on each app's command line, so the match can
# only ever hit this run's windows. Parking by name would move the DM's real Evermist off their
# own screen mid-session.
#
# ⚠ THIS ONLY WORKS BECAUSE OCCLUSION HANDLING IS OFF (KEEP_PAINTING in run.js). Chromium
# normally stops painting a window it believes nobody can see, and a window parked at -9000 is
# the strongest possible case of that. With those switches the renderer keeps drawing, every
# screenshot still comes back, and CDP never touches the screen anyway.
#
# The move is SWP_NOACTIVATE, so nothing steals focus on its way out of sight.
#
# It also WATCHES: any window of this run shown on a screen, or taking focus, is a line in the
# offence log, and run.js fails the scenario it landed in. Parking is the cure; this is the proof.

param([string]$Marker, [int]$Seconds = 900, [string]$ReadyFile = '', [string]$OffenceLog = '')

Add-Type @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public class Off {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after,
      int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint a, uint b, IntPtr m, WinEventProc p, uint pid, uint tid, uint f);
  [DllImport("user32.dll")] static extern bool PeekMessage(out MSG m, IntPtr h, uint a, uint b, uint r);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
  public delegate void WinEventProc(IntPtr hk, uint ev, IntPtr h, int obj, int child, uint th, uint t);
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr h; public uint m; public IntPtr w, l; public uint t; public int x, y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  const uint NOSIZE = 0x0001, NOZORDER = 0x0004, NOACTIVATE = 0x0010;
  public const int PARK_X = -9000, PARK_Y = -9000;
  // ⚠ HIDDEN WINDOWS ARE PARKED TOO, AND THAT IS THE WHOLE POINT. Both of the app's windows are
  // created with show:false and shown a moment later, so a pass that skipped hidden ones could
  // only ever move a window AFTER it had appeared — which is exactly one poll interval of it
  // sitting on screen. Moving it while it is still hidden means it is already parked when it
  // shows, and never appears at all.
  public static int Park(HashSet<uint> want) {
    int moved = 0;
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (!want.Contains(pid)) return true;
      RECT r; GetWindowRect(h, out r);
      // Zero-sized message-only windows have no position worth moving.
      if (r.R - r.L <= 0 || r.B - r.T <= 0) return true;
      // Already parked. Re-moving every tick would fight a window mid-resize.
      if (r.L <= PARK_X && r.T <= PARK_Y) return true;
      SetWindowPos(h, IntPtr.Zero, PARK_X, PARK_Y, 0, 0, NOSIZE | NOZORDER | NOACTIVATE);
      moved++;
      return true;
    }, IntPtr.Zero);
    return moved;
  }

  // ─── The watch ───
  // A window is seen before its pid is known to be this run's (the pid scan is every 250ms), so an
  // event waits in Pending until the scan claims or disowns its pid. Matching on the name alone
  // would blame the DM's own Evermist.
  public static HashSet<uint> Ever = new HashSet<uint>();
  static List<KeyValuePair<uint, string>> Pending = new List<KeyValuePair<uint, string>>();
  static List<long> PendingAt = new List<long>();
  static WinEventProc Keep;
  static string LogPath;

  public static void Watch(string log) {
    LogPath = log;
    Keep = OnEvent;
    SetWinEventHook(0x0003, 0x0003, IntPtr.Zero, Keep, 0, 0, 0);   // foreground
    SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, Keep, 0, 0, 0);   // show
    SetWinEventHook(0x800B, 0x800B, IntPtr.Zero, Keep, 0, 0, 0);   // location change
  }

  static void OnEvent(IntPtr hk, uint ev, IntPtr h, int obj, int child, uint th, uint t) {
    if (h == IntPtr.Zero || obj != 0 || child != 0 || GetAncestor(h, 2) != h) return;
    uint pid; GetWindowThreadProcessId(h, out pid);
    string name;
    try { name = Process.GetProcessById((int)pid).ProcessName; } catch { return; }
    if (name != "electron" && name != "Evermist") return;
    RECT r; GetWindowRect(h, out r);
    var title = new StringBuilder(200); GetWindowText(h, title, 200);
    string what;
    if (ev == 0x0003) what = "took focus";
    else {
      if (!IsWindowVisible(h)) return;
      int vx = GetSystemMetrics(76), vy = GetSystemMetrics(77), vw = GetSystemMetrics(78), vh = GetSystemMetrics(79);
      if (r.R <= vx || r.B <= vy || r.L >= vx + vw || r.T >= vy + vh) return;
      what = "showed on screen";
    }
    Pending.Add(new KeyValuePair<uint, string>(pid, "\"" + title + "\" " + what + " at " + r.L + "," + r.T));
    PendingAt.Add(Environment.TickCount);
  }

  // Pumps the hooks for ms milliseconds, and writes every pending event whose pid is this run's.
  public static void Pump(int ms) {
    long until = Environment.TickCount + ms;
    MSG m;
    while (Environment.TickCount < until) {
      while (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); }
      System.Threading.Thread.Sleep(5);
    }
    for (int i = Pending.Count - 1; i >= 0; i--) {
      bool ours = Ever.Contains(Pending[i].Key);
      if (ours) { try { File.AppendAllText(LogPath, Pending[i].Value + Environment.NewLine); } catch { } }
      if (ours || Environment.TickCount - PendingAt[i] > 3000) { Pending.RemoveAt(i); PendingAt.RemoveAt(i); }
    }
  }
}
"@

if ($OffenceLog) { [Off]::Watch($OffenceLog) }

# Compiled and ready to move a window. run.js holds the first app back until this appears.
if ($ReadyFile) { try { New-Item -ItemType File -Path $ReadyFile -Force | Out-Null } catch { } }

# The window pass runs every 40ms; rediscovering PIDs is a CIM query, so it runs far less often.
# A new app instance is therefore covered within a quarter second of starting, still well before
# Electron has a window to show.
$deadline = (Get-Date).AddSeconds($Seconds)
$pids = New-Object 'System.Collections.Generic.HashSet[uint32]'
$nextScan = [DateTime]::MinValue

while ((Get-Date) -lt $deadline) {
  try {
    if ((Get-Date) -ge $nextScan) {
      $nextScan = (Get-Date).AddMilliseconds(250)
      $found = New-Object 'System.Collections.Generic.HashSet[uint32]'
      # ⚠ BOTH NAMES. A plain run launches node_modules' electron.exe, but `--exe` launches the
      # BUILT app, which is Evermist.exe — filtering on electron.exe alone left every packaging
      # run unparked, which is the one case the screen guard tells you to reach for.
      Get-CimInstance Win32_Process -ErrorAction SilentlyContinue `
        -Filter "Name='electron.exe' OR Name='Evermist.exe'" |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Marker) } |
        ForEach-Object { [void]$found.Add([uint32]$_.ProcessId) }
      $pids = $found
      foreach ($p in $found) { [void][Off]::Ever.Add($p) }
    }
    if ($pids.Count -gt 0) { [void][Off]::Park($pids) }
  } catch { }
  if ($OffenceLog) { [Off]::Pump(40) } else { Start-Sleep -Milliseconds 40 }
}
