import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { bindWorkspace, resetWorkspaceStoreForTests } from '../../server/store/workspaceStore';
import { detectFormatter, formatWorkspaceFiles, summarizeFormatting } from '../../server/services/codeFormatter';

/**
 * Tidying the code an agent wrote is the one step that changes files the user already reviewed,
 * so its boundaries matter more than its features: it must use the project's own formatter, only
 * touch the files just written, never print or rewrite a secret, and never fail the write.
 *
 * A stub formatter is used instead of a real Prettier on purpose: it makes the assertions about
 * *which files it was given* exact, and it keeps the suite from depending on a package that is
 * not part of this project's own dependencies.
 */

const STUB_PRETTIER = [
  "const fs = require('fs');",
  'const args = process.argv.slice(2).filter((entry) => fs.existsSync(entry) && fs.statSync(entry).isFile());',
  'let changed = 0;',
  'for (const file of args) {',
  "  const text = fs.readFileSync(file, 'utf8');",
  "  const tidy = text.replace(/\"/g, \"'\");",
  '  if (tidy !== text) {',
  '    fs.writeFileSync(file, tidy);',
  '    changed += 1;',
  '  }',
  '}',
  "console.log('stub formatter rewrote ' + changed + ' file(s)');"
].join('\n');

const STUB_BIOME = [
  "const fs = require('fs');",
  'const args = process.argv.slice(2).filter((entry) => fs.existsSync(entry) && fs.statSync(entry).isFile());',
  'for (const file of args) {',
  "  const text = fs.readFileSync(file, 'utf8');",
  "  fs.writeFileSync(file, text.replace(/;[ \\t]*\\n/g, '\\n'));",
  '}',
  "console.log('stub biome formatted');"
].join('\n');

let sandbox: string;
let projectRoot: string;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-format-'));
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
  process.env.EPC_WORKSPACE_BACKUP_DIR = path.join(sandbox, 'backups');
});

beforeEach(() => {
  resetWorkspaceStoreForTests();
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'project-'));
  bindWorkspace(projectRoot);
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
  const absolute = path.join(projectRoot, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
}

function installStubPrettier(): void {
  write('node_modules/prettier/bin/prettier.cjs', STUB_PRETTIER);
}

function writePackage(devDependencies: Record<string, string>): void {
  write('package.json', JSON.stringify({ name: 'demo', devDependencies }, null, 2));
}

describe('Tidying up after a write', () => {
  it('1. says so plainly when the folder has no formatter at all', async () => {
    write('src/app.js', 'const a = "x";\n');

    const result = await formatWorkspaceFiles(['src/app.js']);

    expect(result.ran).toBe(false);
    expect(result.tool).toBeNull();
    expect(result.note).toBe('no_formatter');
    expect(detectFormatter(projectRoot)).toBeNull();
    // The file is untouched, and the write that preceded it is not a failure.
    expect(fs.readFileSync(path.join(projectRoot, 'src/app.js'), 'utf8')).toBe('const a = "x";\n');
  });

  it('2. runs the project’s own formatter and reports exactly which files it changed', async () => {
    installStubPrettier();
    writePackage({ prettier: '3.3.3' });
    write('src/tidy.js', 'const a = "x";\n');
    write('src/already.js', "const b = 'y';\n");

    const result = await formatWorkspaceFiles(['src/tidy.js', 'src/already.js']);

    expect(result.ran).toBe(true);
    expect(result.tool).toBe('prettier');
    expect(result.toolLabel).toBe('Prettier');
    expect(result.commandLine).toContain('prettier.cjs');
    expect(result.files).toEqual(['src/tidy.js', 'src/already.js']);
    // Only the file that actually needed it is reported, even though both were passed in.
    expect(result.changed).toEqual(['src/tidy.js']);
    expect(fs.readFileSync(path.join(projectRoot, 'src/tidy.js'), 'utf8')).toBe("const a = 'x';\n");
    expect(result.note).toBeUndefined();
  });

  it('3. prefers the formatter the project declares over one that merely exists', async () => {
    installStubPrettier();
    write('node_modules/@biomejs/biome/bin/biome', STUB_BIOME);
    write('biome.json', '{}');
    writePackage({ '@biomejs/biome': '1.9.4', prettier: '3.3.3' });

    const detected = detectFormatter(projectRoot);
    expect(detected?.id).toBe('biome');

    write('src/app.ts', 'const a = 1;;\n');
    const result = await formatWorkspaceFiles(['src/app.ts']);
    expect(result.tool).toBe('biome');
    expect(result.changed).toEqual(['src/app.ts']);
  });

  it('4. never touches a file outside the folder or one that looks like a secret', async () => {
    installStubPrettier();
    writePackage({ prettier: '3.3.3' });
    write('.env', 'TOKEN="secret"\n');
    write('src/app.js', 'const a = "x";\n');

    const outside = path.join(sandbox, 'outside.txt');
    fs.writeFileSync(outside, 'untouched "quotes"\n', 'utf8');

    const result = await formatWorkspaceFiles(['../outside.txt', '.env', 'src/app.js']);

    expect(result.files).toEqual(['src/app.js']);
    expect(result.skipped).toEqual(['../outside.txt', '.env']);
    expect(fs.readFileSync(outside, 'utf8')).toBe('untouched "quotes"\n');
    expect(fs.readFileSync(path.join(projectRoot, '.env'), 'utf8')).toBe('TOKEN="secret"\n');
  });

  it('5. skips files the chosen formatter is not responsible for', async () => {
    write('node_modules/@biomejs/biome/bin/biome', STUB_BIOME);
    write('biome.json', '{}');
    writePackage({ '@biomejs/biome': '1.9.4' });
    write('README.md', 'const a = "x";\n');
    write('src/app.ts', 'const a = 1;;\n');

    const result = await formatWorkspaceFiles(['README.md', 'src/app.ts']);

    expect(result.files).toEqual(['src/app.ts']);
    expect(result.skipped).toEqual(['README.md']);
    expect(fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8')).toBe('const a = "x";\n');
  });

  it('6. reports a formatter that fails, and leaves the files as they were written', async () => {
    write(
      'node_modules/prettier/bin/prettier.cjs',
      ["console.error('Cannot find config file .prettierrc');", 'process.exit(2);'].join('\n')
    );
    writePackage({ prettier: '3.3.3' });
    write('src/app.js', 'const a = "x";\n');

    const result = await formatWorkspaceFiles(['src/app.js']);

    expect(result.ran).toBe(true);
    expect(result.error).toContain('Cannot find config file');
    expect(result.changed).toEqual([]);
    expect(fs.readFileSync(path.join(projectRoot, 'src/app.js'), 'utf8')).toBe('const a = "x";\n');
  });

  it('7. answers “nothing to format” instead of pretending to work', async () => {
    installStubPrettier();
    writePackage({ prettier: '3.3.3' });

    const empty = await formatWorkspaceFiles([]);
    expect(empty.ran).toBe(false);
    expect(empty.note).toBe('no_files');

    const missing = await formatWorkspaceFiles(['src/not-there.js']);
    expect(missing.files).toEqual([]);
    expect(missing.skipped).toEqual(['src/not-there.js']);
    expect(missing.note).toBe('nothing_to_format');

    write('src/tidy.js', "const a = 'x';\n");
    const tidy = await formatWorkspaceFiles(['src/tidy.js']);
    expect(tidy.ran).toBe(true);
    expect(tidy.changed).toEqual([]);
    expect(tidy.note).toBe('nothing_to_format');
  });

  it('9. formats what it can when one file does not parse, and leaves that file byte for byte', async () => {
    // A real Prettier behaves this way: it refuses the file it cannot parse, still formats the rest,
    // and exits non-zero. The write that just happened must not be turned into a failure because of
    // it, and the file must not be rewritten from a parse it never managed to finish.
    write(
      'node_modules/prettier/bin/prettier.cjs',
      [
        "const fs = require('fs');",
        'let refused = 0;',
        'for (const file of process.argv.slice(2)) {',
        "  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;",
        "  const text = fs.readFileSync(file, 'utf8');",
        "  if (text.includes('BROKEN')) {",
        "    console.error('[error] ' + file + \": SyntaxError: ':' expected. (2:10)\");",
        '    refused += 1;',
        '    continue;',
        '  }',
        "  fs.writeFileSync(file, text.replace(/\"/g, \"'\"));",
        '}',
        'if (refused) process.exitCode = 2;'
      ].join('\n')
    );
    writePackage({ prettier: '3.3.3' });
    write('src/tidy.js', 'const a = "x";\n');
    write('src/broken.js', 'const BROKEN = {\n  a: 1 1\n};\n');

    const result = await formatWorkspaceFiles(['src/tidy.js', 'src/broken.js']);

    // Both files were handed to the tool…
    expect(result.ran).toBe(true);
    expect(result.tool).toBe('prettier');
    expect(result.files).toEqual(['src/tidy.js', 'src/broken.js']);
    // …the good one was tidied…
    expect(result.changed).toEqual(['src/tidy.js']);
    expect(fs.readFileSync(path.join(projectRoot, 'src/tidy.js'), 'utf8')).toBe("const a = 'x';\n");
    // …and the reason for the refusal arrives as a message, not as an exception.
    expect(result.error).toContain('SyntaxError');
    expect(fs.readFileSync(path.join(projectRoot, 'src/broken.js'), 'utf8')).toBe('const BROKEN = {\n  a: 1 1\n};\n');
  });

  it('8. summarizes a tidy-up for the timeline, and stays silent when nothing ran', async () => {
    installStubPrettier();
    writePackage({ prettier: '3.3.3' });
    write('src/tidy.js', 'const a = "x";\n');

    const result = await formatWorkspaceFiles(['src/tidy.js']);
    const summary = summarizeFormatting(result);
    expect(summary).toMatchObject({ tool: 'Prettier', changed: 1, files: 1 });
    expect(summary?.error).toBeUndefined();

    const nothing = await formatWorkspaceFiles([]);
    expect(summarizeFormatting(nothing)).toBeNull();
  });
});
