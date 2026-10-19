import { describe, expect, it } from 'vitest';

import {
  MAX_TASK_FILES,
  TASK_FILE_DRAG_TYPE,
  cleanTaskFilePath,
  mergeTaskFiles,
  removeTaskFile,
  taskFilePathsFromDrop
} from '../utils/taskFiles';

/**
 * The files a card is told to work on. These rules are checked without a browser because they are
 * what turns untrusted drop text into a path the plan can open: one bad entry either repeats a
 * file or names one that cannot be compiled.
 */
describe('A file dropped on a card', () => {
  it('1. takes a plain project path as it is', () => {
    expect(cleanTaskFilePath('src/components/PlanCanvas.tsx')).toBe('src/components/PlanCanvas.tsx');
  });

  it('2. turns the shapes a row or the desktop sends into that same path', () => {
    expect(cleanTaskFilePath('  ./src/App.tsx  ')).toBe('src/App.tsx');
    expect(cleanTaskFilePath('src\\App.tsx')).toBe('src/App.tsx');
    expect(cleanTaskFilePath('"src/App.tsx"')).toBe('src/App.tsx');
    expect(cleanTaskFilePath('file:///C:/repo/src/App.tsx')).toBe('C:/repo/src/App.tsx');
    expect(cleanTaskFilePath('src/App.tsx\nsrc/main.tsx')).toBe('src/App.tsx');
  });

  it('3. refuses what is not a file in this project', () => {
    expect(cleanTaskFilePath('')).toBeNull();
    expect(cleanTaskFilePath('   ')).toBeNull();
    expect(cleanTaskFilePath('https://example.com/src/App.tsx')).toBeNull();
    expect(cleanTaskFilePath('data:text/plain,hello')).toBeNull();
    expect(cleanTaskFilePath('/home/me/repo/src/App.tsx')).toBeNull();
    expect(cleanTaskFilePath('src/')).toBeNull();
    expect(cleanTaskFilePath('x'.repeat(401))).toBeNull();
    expect(cleanTaskFilePath(null)).toBeNull();
    expect(cleanTaskFilePath(42)).toBeNull();
  });

  it('4. appends without repeating a file, whatever its slash or case', () => {
    expect(mergeTaskFiles(['src/App.tsx'], ['src\\App.tsx', 'src/main.tsx'])).toEqual([
      'src/App.tsx',
      'src/main.tsx'
    ]);
  });

  it('5. keeps the newest pick and drops the oldest at the limit', () => {
    const current = Array.from({ length: MAX_TASK_FILES }, (_, i) => `src/f${i}.ts`);
    const merged = mergeTaskFiles(current, ['src/new.ts']);

    expect(merged).toHaveLength(MAX_TASK_FILES);
    expect(merged[0]).toBe('src/f1.ts');
    expect(merged[merged.length - 1]).toBe('src/new.ts');
  });

  it('6. ignores an empty list and an unreadable drop without touching the card', () => {
    expect(mergeTaskFiles(undefined, [])).toEqual([]);
    expect(mergeTaskFiles(['src/App.tsx'], ['', 'src/'])).toEqual(['src/App.tsx']);
  });

  it('7. reads the path from a drop, typed format first and plain text as the fallback', () => {
    const typed = (type: string) => (type === TASK_FILE_DRAG_TYPE ? 'src/App.tsx' : 'src/wrong.ts');
    expect(taskFilePathsFromDrop(typed)).toEqual(['src/App.tsx']);

    const plain = (type: string) => (type === 'text/plain' ? 'src/main.tsx\r\nsrc/App.tsx' : '');
    expect(taskFilePathsFromDrop(plain)).toEqual(['src/main.tsx', 'src/App.tsx']);

    expect(taskFilePathsFromDrop(() => '')).toEqual([]);
  });

  it('8. removes the file by the same cleaned name, and nothing else', () => {
    expect(removeTaskFile(['src/App.tsx', 'src/main.tsx'], './src/App.tsx')).toEqual(['src/main.tsx']);
    expect(removeTaskFile(['src/App.tsx'], 'src/other.ts')).toEqual(['src/App.tsx']);
    expect(removeTaskFile(undefined, 'src/App.tsx')).toEqual([]);
  });
});
