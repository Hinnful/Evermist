# offscreen.ps1 — keeps the rig's app windows off the screen for the length of a run, so a run
# no longer takes the machine away from whoever is using it. WINDOWS ONLY.
#
#   powershell -ExecutionPolicy Bypass -File offscreen.ps1 <marker> <seconds> <ready-file>
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

param([string]$Marker, [int]$Seconds = 900, [string]$ReadyFile = '')

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class Off {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after,
      int x, int y, int cx, int cy, uint flags);
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
}
"@

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
    }
    if ($pids.Count -gt 0) { [void][Off]::Park($pids) }
  } catch { }
  Start-Sleep -Milliseconds 40
}
