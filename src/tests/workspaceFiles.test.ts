import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  WorkspaceError,
  bindWorkspace,
  getBackupRoot,
  getWorkspaceRoot,
  resetWorkspaceStoreForTests,
  resolveWorkspacePath
} from '../../server/store/workspaceStore';
import {
  applyFileChanges,
  browseFolders,
  listBackups,
  readWorkspaceTextFile,
  scanWorkspace,
  undoFileChanges,
  writeWorkspaceTextFile
} from '../../server/services/workspaceFiles';

/**
 * The file service works on a real (temporary) folder. The store path is redirected to the
 * temp directory as well, so the developer's own data/workspace.json is never touched.
 */
let sandbox: string;
let projectRoot: string;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-workspace-'));
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
  process.env.EPC_WORKSPACE_BACKUP_DIR = path.join(sandbox, 'backups');
});

beforeEach(() => {
  resetWorkspaceStoreForTests();
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'project-'));

  fs.mkdirSync(path.join(projectRoot, 'Assets', 'Scripts'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'Assets', 'Scripts', 'Player.cs'), 'class Player {}\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, 'README.md'), '# Demo project\n', 'utf8');
  fs.writeFileSync(path.join(projectRoot, '.env'), 'SECRET_TOKEN=abcdef\n', 'utf8');

  fs.mkdirSync(path.join(projectRoot, 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n', 'utf8');
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.git', 'config'), '[core]\n', 'utf8');
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('Connected project folder', () => {
  it('1. refuses to connect when no folder is bound yet', () => {
    expect(getWorkspaceRoot()).toBeNull();
    expect(() => scanWorkspace()).toThrow(WorkspaceError);
  });

  it('2. refuses a folder that does not exist or is a file', () => {
    expect(() => bindWorkspace(path.join(sandbox, 'definitely-missing'))).toThrow(/does not exist/i);
    const filePath = path.join(projectRoot, 'README.md');
    expect(() => bindWorkspace(filePath)).toThrow(/not a folder/i);
  });

  it('3. connects a real folder, ignoring build folders, secrets and dot-folders', () => {
    bindWorkspace(projectRoot);
    expect(getWorkspaceRoot()).toBe(path.resolve(projectRoot));

    const scan = scanWorkspace();
    const paths = scan.files.map((file) => file.path);

    expect(paths).toContain('Assets/Scripts/Player.cs');
    expect(paths).toContain('README.md');
    expect(paths).not.toContain('.env');
    expect(paths.some((p) => p.startsWith('node_modules/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.git/'))).toBe(false);

    const player = scan.files.find((file) => file.path === 'Assets/Scripts/Player.cs');
    expect(player?.type).toBe('code');
    expect(player?.dir).toBe('Assets/Scripts');
    expect(player?.isText).toBe(true);
  });

  it('4. writes new files, keeping the folder structure intact', () => {
    bindWorkspace(projectRoot);
    const result = writeWorkspaceTextFile('Assets/Scripts/Enemies/Enemy.cs', 'class Enemy {}\n');

    expect(result.status).toBe('created');
    expect(fs.readFileSync(path.join(projectRoot, 'Assets', 'Scripts', 'Enemies', 'Enemy.cs'), 'utf8')).toBe(
      'class Enemy {}\n'
    );
  });
});

describe('Path safety', () => {
  beforeEach(() => {
    bindWorkspace(projectRoot);
  });

  it('5. blocks paths that climb out of the project folder', () => {
    expect(() => resolveWorkspacePath('../outside.txt')).toThrow(WorkspaceError);
    expect(() => resolveWorkspacePath('Assets/../../outside.txt')).toThrow(/outside/i);
    expect(() => resolveWorkspacePath('C:\\Windows\\System32\\drivers\\etc\\hosts')).toThrow(/Absolute paths/i);
  });

  it('6. never reads or writes files that look like secrets', () => {
    expect(() => resolveWorkspacePath('.env')).toThrow(/secret/i);
    expect(() => readWorkspaceTextFile('.env')).toThrow(/secret/i);
    expect(() => writeWorkspaceTextFile('.env', 'SECRET=1')).toThrow(/secret/i);
    expect(() => writeWorkspaceTextFile('keys/server.pem', 'x')).toThrow(/secret/i);
  });

  it('7. rejects writes outside the folder even through the batch API', () => {
    const result = applyFileChanges([{ path: '../escape.txt', action: 'create', content: 'nope' }]);
    expect(result.failed).toBe(1);
    expect(result.results[0].status).toBe('failed');
    expect(fs.existsSync(path.join(sandbox, 'escape.txt'))).toBe(false);
  });
});

describe('Applying AI changes and undoing them', () => {
  beforeEach(() => {
    bindWorkspace(projectRoot);
  });

  it('8. applies a batch, backs up overwritten files and restores them on undo', () => {
    const applied = applyFileChanges([
      { path: 'Assets/Scripts/Enemy.cs', action: 'create', content: 'class Enemy {}\n' },
      { path: 'Assets/Scripts/Player.cs', action: 'update', content: 'class Player { int hp = 100; }\n' },
      { path: 'Assets/Scripts/Missing.cs', action: 'delete', content: '' }
    ]);

    expect(applied.failed).toBe(0);
    expect(applied.applied).toBe(2);
    expect(applied.results.map((r) => r.status)).toEqual(['created', 'updated', 'skipped']);
    expect(fs.readFileSync(path.join(projectRoot, 'Assets', 'Scripts', 'Player.cs'), 'utf8')).toBe(
      'class Player { int hp = 100; }\n'
    );

    const undone = undoFileChanges(applied.backupId);
    expect(undone.failed).toBe(0);
    expect(fs.existsSync(path.join(projectRoot, 'Assets', 'Scripts', 'Enemy.cs'))).toBe(false);
    expect(fs.readFileSync(path.join(projectRoot, 'Assets', 'Scripts', 'Player.cs'), 'utf8')).toBe('class Player {}\n');
  });

  it('9. deletes a file on request and brings it back on undo', () => {
    const applied = applyFileChanges([{ path: 'README.md', action: 'delete', content: '' }]);
    expect(applied.results[0].status).toBe('deleted');
    expect(fs.existsSync(path.join(projectRoot, 'README.md'))).toBe(false);

    undoFileChanges(applied.backupId);
    expect(fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8')).toBe('# Demo project\n');
  });

  it('10. refuses an empty batch and an unknown backup id', () => {
    expect(() => applyFileChanges([])).toThrow(/no changes/i);
    expect(() => undoFileChanges('../../etc')).toThrow(WorkspaceError);
    expect(() => undoFileChanges('2026-01-01T00-00-00-000Z-nope')).toThrow(/cannot be found/i);
  });

  it('11. lists the backups that were taken so the UI can offer a restore', () => {
    const applied = applyFileChanges([{ path: 'Assets/Scripts/Enemy.cs', action: 'create', content: 'class Enemy {}\n' }]);
    const backups = listBackups();
    expect(backups.length).toBeGreaterThan(0);
    expect(backups[0].id).toBe(applied.backupId);
    expect(backups[0].fileCount).toBe(1);
    expect(backups[0].applied).toBe(1);
  });
});

describe('One folder, more than one process', () => {
  /*
   * The desktop window serves the API itself, but the folder is decided once for the app, and the
   * file on disk is where it is remembered. Another window or a dev server can bind it while this
   * one is already running; reading the file once at boot left the running server answering
   * "no folder" while the Files screen and the Auto run needed the opposite.
   */
  it('sees a folder connected by another process, and its removal', () => {
    const file = process.env.EPC_WORKSPACE_FILE as string;
    expect(getWorkspaceRoot()).toBeNull();

    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, root: projectRoot, updatedAt: new Date().toISOString() }),
      'utf8'
    );
    expect(getWorkspaceRoot()).toBe(path.resolve(projectRoot));

    fs.writeFileSync(file, JSON.stringify({ version: 1, root: null, updatedAt: new Date().toISOString() }), 'utf8');
    expect(getWorkspaceRoot()).toBeNull();
  });
});

describe('App runtime data folder', () => {
  it('13. keeps backups inside data/ and out of the project\'s lint and test scope', () => {
    // A real run has no override, so this is the folder the app would write the user's project
    // files into (copied verbatim before overwriting them).
    const override = process.env.EPC_WORKSPACE_BACKUP_DIR;
    delete process.env.EPC_WORKSPACE_BACKUP_DIR;
    const backupRoot = getBackupRoot();
    process.env.EPC_WORKSPACE_BACKUP_DIR = override;

    const relative = path.relative(process.cwd(), backupRoot).split(path.sep).join('/');
    expect(relative.startsWith('data/')).toBe(true);

    // A connected folder may hold *.ts / *.test.ts files. Their backup copies used to be picked
    // up by `npm run lint` and `npm test`, which broke both the moment a change was applied.
    const tsconfig = fs.readFileSync(path.join(process.cwd(), 'tsconfig.json'), 'utf8');
    const vitestConfig = fs.readFileSync(path.join(process.cwd(), 'vitest.config.ts'), 'utf8');
    expect(tsconfig).toMatch(/"exclude"\s*:\s*\[[^\]]*"data"/);
    expect(vitestConfig).toMatch(/'data\/\*\*'/);
  });
});

describe('Folder picker', () => {
  it('12. lists only real subfolders and hides build/noise folders', () => {
    const result = browseFolders(projectRoot);
    const names = result.entries.map((entry) => entry.name);

    expect(names).toContain('Assets');
    expect(names).not.toContain('node_modules');
    expect(result.parent).toBe(sandbox);

    const withoutPath = browseFolders('');
    expect(withoutPath.entries).toEqual([]);
    expect(withoutPath.roots.length).toBeGreaterThan(0);
  });
});
