# offscreen.ps1 — keeps the app's windows off the screen for the length of a rig run, so a run
# no longer takes the machine away from whoever is using it. WINDOWS ONLY.
#
#   powershell -ExecutionPolicy Bypass -File offscreen.ps1 <electron-pid> <seconds>
#
# run.js spawns this and kills it with the app. Do not run it by hand against a real Evermist.
#
# ⚠ THIS ONLY WORKS BECAUSE OCCLUSION HANDLING IS OFF (KEEP_PAINTING in run.js). Chromium
# normally stops painting a window it believes nobody can see, and a window parked at -8000 is
# the strongest possible case of that. With those switches the renderer keeps drawing, every
# screenshot still comes back, and CDP never touches the screen anyway.
#
# The move is SWP_NOACTIVATE, so nothing steals focus on its way out of sight.

param([int]$TargetPid, [int]$Seconds = 900)

Add-Type @"
using System;
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
  public static int Park(uint want) {
    int moved = 0;
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != want) return true;
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

$deadline = (Get-Date).AddSeconds($Seconds)
while ((Get-Date) -lt $deadline) {
  try {
    if (-not (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue)) { break }
    [void][Off]::Park([uint32]$TargetPid)
  } catch { }
  Start-Sleep -Milliseconds 40
}
