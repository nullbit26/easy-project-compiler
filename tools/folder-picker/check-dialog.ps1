# Diagnostic used during development: reports which Windows dialog implementation is on screen.
# The modern IFileOpenDialog (what the app asks for) hosts a DUIViewWndClassName child; the
# legacy BrowseForFolder popup hosts a SysTreeView32 instead.
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class WinTree
{
    private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr hWnd, EnumProc callback, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder name, int max);

    public static string Dump(IntPtr root)
    {
        StringBuilder names = new StringBuilder();
        EnumChildWindows(root, delegate(IntPtr hWnd, IntPtr lParam)
        {
            StringBuilder name = new StringBuilder(256);
            GetClassName(hWnd, name, 256);
            names.Append(name.ToString()).Append(" | ");
            return true;
        }, IntPtr.Zero);
        return names.ToString();
    }
}
'@

$dialog = Get-Process powershell -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle -like '*project folder*' } |
  Select-Object -First 1

if (-not $dialog) {
  Write-Output 'DIALOG_NOT_FOUND'
  exit 1
}

Write-Output ("TITLE: " + $dialog.MainWindowTitle)
$classes = [WinTree]::Dump($dialog.MainWindowHandle)
Write-Output ("CHILDREN: " + $classes)

if ($classes -like '*DUIViewWndClassName*') {
  Write-Output 'RESULT: modern Explorer dialog (IFileOpenDialog + FOS_PICKFOLDERS)'
} elseif ($classes -like '*SysTreeView32*') {
  Write-Output 'RESULT: legacy tree dialog'
} else {
  Write-Output 'RESULT: unknown dialog'
}
