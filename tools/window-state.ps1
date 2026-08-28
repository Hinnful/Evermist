# window-state.ps1 — samples the REAL OS window state of every Electron process to a log, four
# times a second. WINDOWS ONLY, and outside the build glob like everything else in tools/.
#
#   powershell -ExecutionPolicy Bypass -File tools/window-state.ps1 C:\path\to\winlog.txt
#
# Start it, run the rig in another shell, stop it, then read the log around the failure.
#
# WHY IT EXISTS. The rig can only ask the page whether it is hidden, and Electron exposes no CDP
# Browser domain, so nothing inside the app can say WHY a window never appeared. This reads the
# window from outside: visible, minimized, enabled, foreground, its rect and its style bits.
#
# A HEALTHY PLAYER, for comparison. It is created at 1200x800 with the visible bit clear
# (style 06CF0000), gains it a moment later (16CF0000), then goes fullscreen at 0,0 screen-sized
# with the border bits cleared (160B0000). A run where it never reaches the last of those, while
# the app reports its renderer at screen size, is the invisible-Player fault.
#
# ⚠ SUSPECT THE PERSON AT THE KEYBOARD FIRST. Another app taking the foreground, or either window
# being minimized, stops the app rendering and makes every measurement read zero — which looks
# exactly like a fault in the app. Check the fg= column and the other windows before blaming code.

Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class W {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr p);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowLongW(IntPtr h, int i);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  public static string Dump(uint want) {
    var sb = new StringBuilder();
    IntPtr fg = GetForegroundWindow();
    EnumWindows((h, p) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid != want) return true;
      var t = new StringBuilder(256); GetWindowTextW(h, t, 256);
      RECT r; GetWindowRect(h, out r);
      // GWL_STYLE 0xFFFFFFF0 = -16, GWL_EXSTYLE = -20
      uint st = GetWindowLongW(h, -16), ex = GetWindowLongW(h, -20);
      sb.Append("    hwnd=").Append(h.ToInt64().ToString("X"))
        .Append(" vis=").Append(IsWindowVisible(h))
        .Append(" min=").Append(IsIconic(h))
        .Append(" enabled=").Append(IsWindowEnabled(h))
        .Append(" fg=").Append(h == fg)
        .Append(" rect=").Append(r.L).Append(",").Append(r.T).Append(" ")
        .Append(r.R - r.L).Append("x").Append(r.B - r.T)
        .Append(" style=").Append(st.ToString("X8"))
        .Append(" ex=").Append(ex.ToString("X8"))
        .Append(" title=\"").Append(t.ToString()).Append("\"\n");
      return true;
    }, IntPtr.Zero);
    return sb.ToString();
  }
}
"@

$log = $args[0]
"probe started $(Get-Date -Format o)" | Out-File -FilePath $log -Encoding utf8
while ($true) {
  $procs = Get-Process electron -ErrorAction SilentlyContinue
  if ($procs) {
    $stamp = (Get-Date -Format "HH:mm:ss.fff")
    $out = "[$stamp]`n"
    foreach ($p in ($procs | Sort-Object Id)) {
      $d = [W]::Dump([uint32]$p.Id)
      if ($d) { $out += "  pid $($p.Id)`n$d" }
    }
    if ($out -notmatch "^\[[^\]]+\]\s*$") { $out | Out-File -FilePath $log -Append -Encoding utf8 }
  }
  Start-Sleep -Milliseconds 250
}
