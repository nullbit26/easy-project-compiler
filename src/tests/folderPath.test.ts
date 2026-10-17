import { describe, it, expect } from 'vitest';
import { isSameFolder, normalizeFolderPath } from '../utils/folderPath';

/**
 * The field note "this folder is not connected yet" must appear exactly when the path in the field
 * is not the folder the app is already connected to — so the comparison has to see through the
 * ways people write the same Windows path, without ignoring real differences.
 */
describe('folder path comparison', () => {
  it('treats Windows spellings of the same folder as equal', () => {
    expect(isSameFolder('C:\\Work\\App', 'c:/work/app')).toBe(true);
    expect(isSameFolder('C:/Work/App/', 'C:\\Work\\App')).toBe(true);
    expect(isSameFolder('C:\\Work\\App\\\\', 'C:/work/app')).toBe(true);
  });

  it('keeps different folders apart', () => {
    expect(isSameFolder('C:\\Work\\App', 'C:\\Work\\App-old')).toBe(false);
    expect(isSameFolder('C:\\Work\\App', 'D:\\Work\\App')).toBe(false);
  });

  it('respects case on POSIX paths', () => {
    expect(isSameFolder('/home/user/app', '/home/user/app')).toBe(true);
    expect(isSameFolder('/home/user/app', '/home/user/App')).toBe(false);
  });

  it('never matches empty or missing paths', () => {
    expect(isSameFolder('', 'C:/Work/App')).toBe(false);
    expect(isSameFolder(undefined, null)).toBe(false);
    expect(isSameFolder('   ', 'C:/Work/App')).toBe(false);
  });

  it('normalises separators and the trailing slash', () => {
    expect(normalizeFolderPath(' C:\\Work\\App\\ ')).toBe('c:/work/app');
    expect(normalizeFolderPath('/home/user/app/')).toBe('/home/user/app');
  });
});
