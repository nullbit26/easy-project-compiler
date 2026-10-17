import { describe, it, expect, afterEach } from 'vitest';
import {
  buildWindowsScript,
  cleanedStderr,
  encodePowerShellCommand,
  folderPickerSupported,
  normalizePickedFolder,
  pickFolder
} from '../../server/services/folderPicker';

/**
 * The dialog itself is a piece of the operating system, so these tests cover everything around
 * it: the script that is handed to PowerShell, the path normalisation, and the decisions the
 * service makes before any window opens.
 */
describe('System folder picker', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    delete process.env.EPC_FOLDER_PICK_RESULT;
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  function pretendPlatform(value: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value });
  }

  it('1. is reported as supported on Windows and macOS, and as unsupported elsewhere', () => {
    pretendPlatform('win32');
    expect(folderPickerSupported()).toBe(true);
    pretendPlatform('darwin');
    expect(folderPickerSupported()).toBe(true);
    pretendPlatform('linux');
    expect(folderPickerSupported()).toBe(false);
  });

  it('2. answers "unsupported" instead of failing when the platform has no native dialog', async () => {
    pretendPlatform('linux');
    const result = await pickFolder();
    expect(result.supported).toBe(false);
    expect(result.path).toBeNull();
  });

  it('3. normalises what the dialog returns: quotes, trailing separators, stray lines', () => {
    expect(normalizePickedFolder('"C:\\Users\\me\\Game"')).toBe('C:\\Users\\me\\Game');
    expect(normalizePickedFolder('C:\\Users\\me\\Game\\\r\n')).toBe('C:\\Users\\me\\Game');
    expect(normalizePickedFolder('/home/me/game/')).toBe('/home/me/game');
    expect(normalizePickedFolder('   ')).toBeNull();
  });

  it('3b. never shows PowerShell progress noise as an error message', () => {
    expect(cleanedStderr('')).toBe('unknown_error');
    expect(cleanedStderr('   ')).toBe('unknown_error');
    const clixml =
      '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">' +
      '<Obj S="progress" RefId="0"><MS><AV>Preparing modules for first use.</AV></MS></Obj></Objs>';
    expect(cleanedStderr(clixml)).toBe('unknown_error');
    expect(cleanedStderr('Add-Type : Cannot add type.')).toBe('Add-Type : Cannot add type.');
  });

  it('4. ships the modern Explorer dialog options, not the legacy tree popup', () => {
    const script = buildWindowsScript('Выберите папку', 'C:\\Projects');
    expect(script).toContain('IFileOpenDialog');
    expect(script).toContain("$ProgressPreference = 'SilentlyContinue'");
    expect(script).toContain('FOS_PICKFOLDERS');
    expect(script).toContain('SetFolder');
    expect(script).not.toContain('BrowseForFolder');
    expect(script).toContain("'C:\\Projects'");
  });

  it('5. escapes quotes so a folder path can never break out of the PowerShell string', () => {
    const script = buildWindowsScript("It's tricky", "C:\\O'Brien\\Game");
    expect(script).toContain("'C:\\O''Brien\\Game'");
    expect(script).toContain("'It''s tricky'");
  });

  it('6. hands PowerShell UTF-16 base64, which is the only encoding it accepts on the command line', () => {
    const encoded = encodePowerShellCommand('Write-Output "Привет"');
    expect(Buffer.from(encoded, 'base64').toString('utf16le')).toBe('Write-Output "Привет"');
  });

  it('7. returns the folder chosen through the test seam without opening any window', async () => {
    process.env.EPC_FOLDER_PICK_RESULT = '"C:\\Users\\me\\Game\\"';
    const picked = await pickFolder({ initialPath: 'C:\\' });
    expect(picked).toEqual({ supported: true, path: 'C:\\Users\\me\\Game', cancelled: false });
  });

  it('8. reports a cancelled dialog when nothing was chosen', async () => {
    process.env.EPC_FOLDER_PICK_RESULT = '  ';
    const result = await pickFolder();
    expect(result.path).toBeNull();
    expect(result.cancelled).toBe(true);
  });
});
