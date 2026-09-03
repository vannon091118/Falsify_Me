# ─────────────────────────────────────────────────────────────────────────────
# FalsifyMe TUI - Dock-Fenster-Capture (OCR-E2E-Abnahme)
#   Findet das sichtbare Fenster mit "Falsify-Dock" im Titel und speichert
#   dessen Bildschirmbereich als PNG. Kein Fenster wird veraendert.
# Verwendung:  powershell -NoProfile -ExecutionPolicy Bypass -File capture-window.ps1 -Out <pfad.png> [-TitleMatch "Falsify-Dock"]
# ─────────────────────────────────────────────────────────────────────────────
param(
  [string]$Out = "$env:TEMP\dock-capture.png",
  [string]$TitleMatch = "Falsify-Dock"
)
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class DockWin32 {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
[void][DockWin32]::SetProcessDPIAware()
$script:found = [IntPtr]::Zero
$callback = [DockWin32+EnumWindowsProc]{
  param($hWnd, $lParam)
  if ([DockWin32]::IsWindowVisible($hWnd)) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][DockWin32]::GetWindowText($hWnd, $sb, 512)
    if ($sb.ToString() -like "*$TitleMatch*") {
      $script:found = $hWnd
      return $false
    }
  }
  return $true
}
[void][DockWin32]::EnumWindows($callback, [IntPtr]::Zero)
if ($script:found -eq [IntPtr]::Zero) {
  Write-Error "Kein Fenster mit Titel-Muster '$TitleMatch' gefunden."
  exit 1
}
$rect = New-Object DockWin32+RECT
[void][DockWin32]::GetWindowRect($script:found, [ref]$rect)
$w = $rect.Right - $rect.Left
$h = $rect.Bottom - $rect.Top
if ($w -le 0 -or $h -le 0) { Write-Error "Fenster-Rect ungueltig ($w x $h)."; exit 1 }
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output ("saved={0} size={1}x{2}" -f $Out, $w, $h)