import { spawn } from 'child_process';
import { normalizeFolderPath } from '../store/workspaceStore';

/**
 * Opens the operating system's own folder picker — the modern Explorer dialog on Windows —
 * instead of an in-app list of folders, and reports the folder the user clicked.
 *
 * The dialog belongs to the machine that runs the server (which is the same machine as the
 * person clicking), and the HTTP request simply waits until the dialog closes.
 */

export interface FolderPickResult {
  /** False on platforms that have no native picker, so the UI can fall back to its own list. */
  supported: boolean;
  path: string | null;
  cancelled?: boolean;
  error?: string;
}

/** Long enough for someone to actually browse, short enough to stay under the HTTP timeout. */
const PICK_TIMEOUT_MS = 170_000;

export function folderPickerSupported(): boolean {
  return process.platform === 'win32' || process.platform === 'darwin';
}

/**
 * Windows PowerShell 5.1 script that shows the Vista+ folder dialog.
 *
 * `IFileOpenDialog` with `FOS_PICKFOLDERS` is the same dialog Explorer itself uses (address bar,
 * quick access, search, "New folder"). The older `Shell.Application.BrowseForFolder` and the
 * WinForms folder dialog render the legacy tree popup, which is exactly what we do not want.
 */
const WINDOWS_PICKER_SCRIPT = `$ErrorActionPreference = 'Stop'
# PowerShell writes "Preparing modules for first use" progress records to stderr on the very
# first run of a session; that noise must never look like a dialog failure.
$ProgressPreference = 'SilentlyContinue'
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NativeFolderPicker
{
    [ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
    private class FileOpenDialogRCW { }

    [ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileOpenDialog
    {
        [PreserveSig] int Show([In] IntPtr parent);
        void SetFileTypes([In] uint cFileTypes, [In] IntPtr rgFilterSpec);
        void SetFileTypeIndex([In] uint iFileType);
        void GetFileTypeIndex(out uint piFileType);
        void Advise([In] IntPtr pfde, out uint pdwCookie);
        void Unadvise([In] uint dwCookie);
        void SetOptions([In] uint fos);
        void GetOptions(out uint pfos);
        void SetDefaultFolder([In] IShellItem psi);
        void SetFolder([In] IShellItem psi);
        void GetFolder(out IShellItem ppsi);
        void GetCurrentSelection(out IShellItem ppsi);
        void SetFileName([In, MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
        void SetTitle([In, MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
        void SetOkButtonLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszText);
        void SetFileNameLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
        void GetResult(out IShellItem ppsi);
    }

    [ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler([In] IntPtr pbc, [In] ref Guid bhid, [In] ref Guid riid, out IntPtr ppv);
        void GetParent(out IShellItem ppsi);
        void GetDisplayName([In] uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
        void GetAttributes([In] uint sfgaoMask, out uint psfgaoAttribs);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(
        [In, MarshalAs(UnmanagedType.LPWStr)] string pszPath,
        [In] IntPtr pbc,
        [In, MarshalAs(UnmanagedType.LPStruct)] Guid riid,
        [MarshalAs(UnmanagedType.Interface)] out IShellItem ppv);

    private const uint FOS_PICKFOLDERS = 0x00000020;
    private const uint FOS_FORCEFILESYSTEM = 0x00000040;
    private const uint SIGDN_FILESYSPATH = 0x80058000;

    public static string Pick(string title, string initialPath)
    {
        IFileOpenDialog dialog = (IFileOpenDialog)new FileOpenDialogRCW();
        try
        {
            uint options;
            dialog.GetOptions(out options);
            dialog.SetOptions(options | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
            if (!string.IsNullOrEmpty(title)) dialog.SetTitle(title);
            if (!string.IsNullOrEmpty(initialPath))
            {
                try
                {
                    IShellItem start;
                    SHCreateItemFromParsingName(initialPath, IntPtr.Zero, typeof(IShellItem).GUID, out start);
                    dialog.SetFolder(start);
                    Marshal.ReleaseComObject(start);
                }
                catch { /* The starting folder is a convenience only. */ }
            }

            // Non-zero HRESULT means the user closed the dialog without choosing (or an error).
            if (dialog.Show(IntPtr.Zero) != 0) return null;

            IShellItem result;
            dialog.GetResult(out result);
            try
            {
                string path;
                result.GetDisplayName(SIGDN_FILESYSPATH, out path);
                return path;
            }
            finally { Marshal.ReleaseComObject(result); }
        }
        finally { Marshal.ReleaseComObject(dialog); }
    }
}
'@
  $picked = [NativeFolderPicker]::Pick(__TITLE__, __INITIAL__)
  if ([string]::IsNullOrWhiteSpace($picked)) { exit 1 }
  Write-Output $picked
  exit 0
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 2
}
`;

/** PowerShell single-quoted literals are literal strings: only ' needs doubling. */
function psLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildWindowsScript(title: string, initialPath: string): string {
  return WINDOWS_PICKER_SCRIPT.replace('__TITLE__', psLiteral(title)).replace(
    '__INITIAL__',
    psLiteral(initialPath)
  );
}

/** PowerShell does not accept UTF-8 on the command line, so the script travels as UTF-16 base64. */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function run(file: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // The dialog may already be gone.
      }
      finish({ code: null, stdout: '', stderr: '', timedOut: true });
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => finish({ code: null, stdout: '', stderr: String(err?.message || err), timedOut: false }));
    // The dialog can be closed by the user at any time; nothing to do about it.
    child.on('close', (code) =>
      finish({
        code,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timedOut: false
      })
    );
  });
}

/**
 * PowerShell can dump a CLIXML progress blob into stderr; that is not an error message and
 * showing it to the user would be nonsense. Keep only a readable last line, if any.
 */
export function cleanedStderr(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return 'unknown_error';
  const withoutClixml = text
    .replace(/<Objs[\s\S]*?<\/Objs>/g, '')
    .replace(/^#<\s*CLIXML\s*/i, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutClixml) return 'unknown_error';
  return withoutClixml.slice(0, 300);
}

/** Trailing separators and surrounding quotes are what the OS and the user hand us. */
export function normalizePickedFolder(raw: string): string | null {
  const cleaned = normalizeFolderPath(raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() || '');
  return cleaned || null;
}

export async function pickFolder(options: { initialPath?: string; title?: string } = {}): Promise<FolderPickResult> {
  // Test seam: lets automated checks exercise the whole connect flow without a human clicking.
  if (process.env.EPC_FOLDER_PICK_RESULT !== undefined) {
    const forced = normalizePickedFolder(process.env.EPC_FOLDER_PICK_RESULT);
    return { supported: true, path: forced, cancelled: !forced };
  }

  if (!folderPickerSupported()) {
    return { supported: false, path: null, error: 'unsupported_platform' };
  }

  const initialPath = normalizeFolderPath(options.initialPath || '');
  const title = options.title || 'Выберите папку проекта / Select the project folder';

  if (process.platform === 'win32') {
    const script = buildWindowsScript(title, initialPath);
    const result = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodePowerShellCommand(script)],
      PICK_TIMEOUT_MS
    );

    if (result.timedOut) {
      return { supported: true, path: null, error: 'timeout' };
    }
    const picked = normalizePickedFolder(result.stdout);
    if (picked) return { supported: true, path: picked };

    // The script exits 1 for "closed without choosing" and 2 for a real failure, so the exit
    // code decides — stderr also carries harmless PowerShell chatter and must not be trusted.
    if (result.code === 2) {
      return { supported: true, path: null, error: cleanedStderr(result.stderr) };
    }
    if (result.code === null) {
      return { supported: true, path: null, error: cleanedStderr(result.stderr) };
    }
    return { supported: true, path: null, cancelled: true };
  }

  // macOS ships the same idea as a one-liner.
  const escapedTitle = title.replace(/"/g, '\\"');
  const defaultLocation = initialPath ? ` default location POSIX file "${initialPath.replace(/"/g, '\\"')}"` : '';
  const script = `POSIX path of (choose folder with prompt "${escapedTitle}"${defaultLocation})`;
  const result = await run('osascript', ['-e', script], PICK_TIMEOUT_MS);
  if (result.timedOut) {
    return { supported: true, path: null, error: 'timeout' };
  }
  const picked = normalizePickedFolder(result.stdout);
  if (picked) return { supported: true, path: picked };
  if (/-128|User canceled/i.test(result.stderr)) {
    return { supported: true, path: null, cancelled: true };
  }
  return { supported: true, path: null, error: cleanedStderr(result.stderr) };
}
