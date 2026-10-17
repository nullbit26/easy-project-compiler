import fs from 'fs';
import path from 'path';
import {
  WorkspaceError,
  getBackupRoot,
  isSensitiveRelativePath,
  requireWorkspaceRoot,
  resolveWorkspacePath,
  toRelativePath
} from '../store/workspaceStore';
import type { ProjectFile } from '../../src/types';
import type { VerificationSummary } from './projectChecks';
import type { FormattingSummary } from './codeFormatter';
import type { WriteWeight } from './changeWeight';

/**
 * Real file-system work for the connected project folder: scanning it, reading a file,
 * writing one, applying a reviewed batch of AI changes and undoing that batch.
 *
 * Everything is path-checked through workspaceStore before it touches the disk.
 */

/** Folders that only ever add noise (and thousands of files) to a scan. */
export const IGNORED_DIRS = new Set([
  '.git', '.svn', '.hg', '.idea', '.vs', '.vscode',
  'node_modules', 'bower_components', 'vendor',
  'dist', 'build', 'out', 'bin', 'obj', 'target', 'coverage', '.nyc_output',
  'Library', 'Temp', 'Logs', 'Obj', 'Build', 'Builds', 'UserSettings', 'MemoryCaptures', 'Packages',
  '.gradle', 'Pods', 'DerivedData', 'Carthage',
  '.next', '.nuxt', '.svelte-kit', '.cache', '.parcel-cache', '.turbo',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.venv', 'venv', 'env', '.tox', 'site-packages',
  '.terraform', '.epc-backups', '.epc'
]);

const CODE_EXTENSIONS = new Set([
  '.cs', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.gd', '.java', '.kt', '.swift',
  '.cpp', '.cc', '.c', '.h', '.hpp', '.lua', '.rb', '.go', '.rs', '.php', '.sh', '.ps1', '.bat',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte', '.sql', '.dart', '.m', '.mm'
]);
const JSON_EXTENSIONS = new Set(['.json', '.jsonc']);
const CONFIG_EXTENSIONS = new Set([
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.xml', '.plist', '.gradle', '.properties',
  '.csproj', '.sln', '.asmdef', '.props', '.targets', '.editorconfig', '.gitignore', '.env-example'
]);
const SCENE_EXTENSIONS = new Set(['.unity', '.tscn', '.scene', '.umap', '.uasset', '.blend']);
const PREFAB_EXTENSIONS = new Set(['.prefab', '.tres', '.res', '.asset', '.material']);
/** Files without an extension that are still plain text worth reading. */
const TEXT_BASENAMES = new Set([
  'makefile', 'dockerfile', 'procfile', 'license', 'licence', 'readme', 'changelog', 'gemfile', 'rakefile'
]);
const RULE_BASENAMES = new Set(['agents.md', 'claude.md', '.cursorrules', '.windsurfrules', 'copilot-instructions.md']);

const MAX_SCAN_FILES = 3000;
const MAX_SCAN_DEPTH = 12;
export const READ_LIMIT_BYTES = 400_000;
export const WRITE_LIMIT_BYTES = 1_000_000;
const MAX_CHANGES_PER_APPLY = 25;

export interface ScannedFile {
  path: string;
  name: string;
  dir: string;
  type: ProjectFile['type'];
  sizeBytes: number;
  isText: boolean;
}

export interface WorkspaceScan {
  root: string;
  files: ScannedFile[];
  truncated: boolean;
  skipped: number;
  scannedAt: string;
}

export type FileChangeAction = 'create' | 'update' | 'delete';

export interface FileChangeInput {
  path: string;
  action: FileChangeAction;
  content?: string;
  reason?: string;
}

export type FileChangeStatus = 'created' | 'updated' | 'deleted' | 'skipped' | 'failed' | 'restored' | 'removed';

export interface FileChangeResult {
  path: string;
  action: FileChangeAction;
  status: FileChangeStatus;
  error?: string;
  sizeBytes?: number;
  /** What the file weighed before this write, so the batch can be weighed exactly. */
  previousBytes?: number;
}

/** Size of a file on disk, or 0 when it cannot be read. */
function sizeOf(absolute: string): number {
  try {
    return fs.statSync(absolute).size;
  } catch {
    return 0;
  }
}

export interface ApplyResult {
  backupId: string;
  root: string;
  results: FileChangeResult[];
  applied: number;
  failed: number;
}

interface BackupEntry {
  path: string;
  existed: boolean;
  action: FileChangeAction;
}

interface BackupManifest {
  version: 1;
  id: string;
  root: string;
  createdAt: string;
  entries: BackupEntry[];
  results: FileChangeResult[];
  /** Optional human label, so the timeline reads like a story instead of a list of ids. */
  label?: string;
  /** Outcome of the check run that followed this batch, when there was one. */
  verification?: VerificationSummary;
  /** What the project's own formatter tidied after this batch, when it ran. */
  formatting?: FormattingSummary;
  /** How heavy this batch was, measured right after it was written. */
  weight?: WriteWeight;
  /** Set when a rollback took this batch back out of the project. */
  rolledBackAt?: string;
}

export function inferFileType(relativePath: string): ProjectFile['type'] {
  const normalized = relativePath.replace(/\\/g, '/');
  const name = normalized.split('/').pop() || normalized;
  const lowerName = name.toLowerCase();
  const ext = path.extname(lowerName);

  if (RULE_BASENAMES.has(lowerName) || /(^|\/)\.cursor\/rules\//.test(`/${normalized}`)) return 'rule';
  if (/(^|\/).*\.(test|spec)\.[a-z0-9]+$/i.test(normalized)) return 'test';
  if (/(^|\/)(test_|.*_test\.|.*tests?\/.*)/i.test(normalized) && /\.(py|go|rb|cs|ts|js)$/.test(lowerName)) return 'test';
  if (SCENE_EXTENSIONS.has(ext)) return 'scene';
  if (PREFAB_EXTENSIONS.has(ext)) return 'prefab';
  if (CONFIG_EXTENSIONS.has(ext)) return 'config';
  if (JSON_EXTENSIONS.has(ext)) return 'json';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  return 'asset';
}

export function isTextFile(relativePath: string): boolean {
  const name = (relativePath.split('/').pop() || '').toLowerCase();
  const ext = path.extname(name);
  if (TEXT_BASENAMES.has(name) || name.startsWith('readme') || name === 'license') return true;
  return (
    CODE_EXTENSIONS.has(ext) ||
    JSON_EXTENSIONS.has(ext) ||
    CONFIG_EXTENSIONS.has(ext) ||
    SCENE_EXTENSIONS.has(ext) ||
    PREFAB_EXTENSIONS.has(ext) ||
    ['.md', '.txt', '.csv', '.log', '.meta', '.svg', '.editorconfig'].includes(ext)
  );
}

/** Walks the connected folder. Returns a flat, sorted list — the UI groups it by directory. */
export function scanWorkspace(): WorkspaceScan {
  const root = requireWorkspaceRoot();
  const files: ScannedFile[] = [];
  let truncated = false;
  let skipped = 0;

  const walk = (absoluteDir: string, depth: number) => {
    if (files.length >= MAX_SCAN_FILES) {
      truncated = true;
      return;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      skipped += 1;
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_SCAN_FILES) {
        truncated = true;
        return;
      }
      const absolute = path.join(absoluteDir, entry.name);
      const relative = toRelativePath(absolute);

      if (entry.isSymbolicLink()) {
        skipped += 1;
        continue;
      }
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name) || entry.name.startsWith('.')) {
          if (!['.cursor', '.github'].includes(entry.name)) {
            skipped += 1;
            continue;
          }
        }
        if (depth >= MAX_SCAN_DEPTH) {
          skipped += 1;
          continue;
        }
        walk(absolute, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        skipped += 1;
        continue;
      }
      if (entry.name.startsWith('.') && !RULE_BASENAMES.has(entry.name.toLowerCase()) && !['.gitignore', '.editorconfig'].includes(entry.name)) {
        skipped += 1;
        continue;
      }
      if (isSensitiveRelativePath(relative)) {
        skipped += 1;
        continue;
      }

      let sizeBytes = 0;
      try {
        sizeBytes = fs.statSync(absolute).size;
      } catch {
        sizeBytes = 0;
      }

      const dir = relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
      files.push({
        path: relative,
        name: entry.name,
        dir,
        type: inferFileType(relative),
        sizeBytes,
        isText: isTextFile(relative)
      });
    }
  };

  walk(root, 0);
  files.sort((a, b) => a.path.localeCompare(b.path));

  return { root, files, truncated, skipped, scannedAt: new Date().toISOString() };
}

export interface ReadFileResult {
  path: string;
  content: string;
  truncated: boolean;
  sizeBytes: number;
}

export function readWorkspaceTextFile(relativePath: unknown, limit = READ_LIMIT_BYTES): ReadFileResult {
  const absolute = resolveWorkspacePath(relativePath);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new WorkspaceError('not_found', `The file does not exist: ${relativePath}`);
  }
  const sizeBytes = fs.statSync(absolute).size;
  const raw = fs.readFileSync(absolute);
  const slice = raw.subarray(0, limit);
  return {
    path: toRelativePath(absolute),
    content: slice.toString('utf8'),
    truncated: raw.length > limit,
    sizeBytes
  };
}

/** Writes one file straight away (used by the plain "save" action in the viewer). */
export function writeWorkspaceTextFile(relativePath: unknown, content: unknown): FileChangeResult {
  if (typeof content !== 'string') {
    throw new WorkspaceError('empty_path', 'The file content must be text.');
  }
  if (Buffer.byteLength(content, 'utf8') > WRITE_LIMIT_BYTES) {
    throw new WorkspaceError('too_large', 'This file is too large to write from the app (1 MB limit).');
  }
  const absolute = resolveWorkspacePath(relativePath);
  const existed = fs.existsSync(absolute);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
  return {
    path: toRelativePath(absolute),
    action: existed ? 'update' : 'create',
    status: existed ? 'updated' : 'created',
    sizeBytes: Buffer.byteLength(content, 'utf8')
  };
}

function normalizeChange(change: FileChangeInput): { path: string; action: FileChangeAction; content: string } {
  const action: FileChangeAction =
    change?.action === 'delete' ? 'delete' : change?.action === 'update' ? 'update' : 'create';
  const content = typeof change?.content === 'string' ? change.content : '';
  if (action !== 'delete' && !content.trim()) {
    throw new WorkspaceError('empty_path', `The change for ${change?.path || 'a file'} has no content.`);
  }
  if (action !== 'delete' && Buffer.byteLength(content, 'utf8') > WRITE_LIMIT_BYTES) {
    throw new WorkspaceError('too_large', `${change.path} is larger than the 1 MB write limit.`);
  }
  return { path: String(change?.path ?? ''), action, content };
}

/**
 * Applies a reviewed batch of changes. Every file that already existed is copied into a
 * backup folder first, so `undoFileChanges` can put the project back exactly as it was.
 */
export function applyFileChanges(changes: unknown, options: { label?: string } = {}): ApplyResult {
  const root = requireWorkspaceRoot();
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new WorkspaceError('no_changes', 'There are no changes to apply.');
  }
  if (changes.length > MAX_CHANGES_PER_APPLY) {
    throw new WorkspaceError('no_changes', `Too many files in one go (limit ${MAX_CHANGES_PER_APPLY}).`);
  }

  const backupId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
  const backupDir = path.join(getBackupRoot(), backupId);
  const entries: BackupEntry[] = [];
  const results: FileChangeResult[] = [];

  for (const rawChange of changes as FileChangeInput[]) {
    const label = String((rawChange as any)?.path ?? '');
    const action: FileChangeAction =
      (rawChange as any)?.action === 'delete' ? 'delete' : (rawChange as any)?.action === 'update' ? 'update' : 'create';
    try {
      const change = normalizeChange({ ...rawChange, action });
      const absolute = resolveWorkspacePath(change.path);
      const relative = toRelativePath(absolute);
      const existed = fs.existsSync(absolute);

      if (change.action === 'delete') {
        if (!existed) {
          results.push({ path: relative, action: 'delete', status: 'skipped', error: 'Already missing.' });
          continue;
        }
        const deletedBytes = sizeOf(absolute);
        fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(absolute, path.join(backupDir, relative.replace(/\//g, '__')));
        entries.push({ path: relative, existed: true, action: 'delete' });
        fs.rmSync(absolute);
        results.push({ path: relative, action: 'delete', status: 'deleted', previousBytes: deletedBytes, sizeBytes: 0 });
        continue;
      }

      const previousBytes = existed ? sizeOf(absolute) : 0;
      if (existed) {
        fs.mkdirSync(backupDir, { recursive: true });
        fs.copyFileSync(absolute, path.join(backupDir, relative.replace(/\//g, '__')));
      }
      entries.push({ path: relative, existed, action: change.action });
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, change.content, 'utf8');
      results.push({
        path: relative,
        action: existed ? 'update' : 'create',
        status: existed ? 'updated' : 'created',
        previousBytes,
        sizeBytes: Buffer.byteLength(change.content, 'utf8')
      });
    } catch (err: any) {
      results.push({
        path: label,
        action,
        status: 'failed',
        error: err instanceof WorkspaceError ? err.message : String(err?.message || err)
      });
    }
  }

  fs.mkdirSync(backupDir, { recursive: true });
  const manifest: BackupManifest = {
    version: 1,
    id: backupId,
    root,
    createdAt: new Date().toISOString(),
    entries,
    results,
    ...(sanitizeLabel(options.label) ? { label: sanitizeLabel(options.label) } : {})
  };
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const failed = results.filter((r) => r.status === 'failed').length;
  return {
    backupId,
    root,
    results,
    applied: results.filter((r) => r.status !== 'failed' && r.status !== 'skipped').length,
    failed
  };
}

function readManifest(backupId: unknown): { manifest: BackupManifest; backupDir: string } {
  const id = String(backupId ?? '');
  if (!/^[A-Za-z0-9._-]+$/.test(id)) {
    throw new WorkspaceError('unknown_backup', 'That backup cannot be found.');
  }
  const backupDir = path.join(getBackupRoot(), id);
  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new WorkspaceError('unknown_backup', 'That backup cannot be found.');
  }
  return { manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')), backupDir };
}

/** Puts the project back the way it was before the matching apply. */
export function undoFileChanges(backupId: unknown): ApplyResult {
  const root = requireWorkspaceRoot();
  const { manifest, backupDir } = readManifest(backupId);
  const results: FileChangeResult[] = [];

  for (const entry of manifest.entries) {
    try {
      const absolute = resolveWorkspacePath(entry.path);
      if (entry.existed) {
        const stored = path.join(backupDir, entry.path.replace(/\//g, '__'));
        if (!fs.existsSync(stored)) {
          results.push({ path: entry.path, action: 'update', status: 'failed', error: 'The backup copy is missing.' });
          continue;
        }
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.copyFileSync(stored, absolute);
        results.push({ path: entry.path, action: 'update', status: 'restored' });
      } else if (fs.existsSync(absolute)) {
        fs.rmSync(absolute);
        results.push({ path: entry.path, action: 'delete', status: 'removed' });
      } else {
        results.push({ path: entry.path, action: 'delete', status: 'skipped', error: 'Already gone.' });
      }
    } catch (err: any) {
      results.push({
        path: entry.path,
        action: entry.action,
        status: 'failed',
        error: err instanceof WorkspaceError ? err.message : String(err?.message || err)
      });
    }
  }

  const failed = results.filter((r) => r.status === 'failed').length;
  return {
    backupId: manifest.id,
    root,
    results,
    applied: results.filter((r) => r.status !== 'failed' && r.status !== 'skipped').length,
    failed
  };
}

export interface BackupSummary {
  id: string;
  createdAt: string;
  root: string;
  fileCount: number;
  applied: number;
  failed: number;
  /** Files this batch touched, so the timeline can show what changed. */
  paths: string[];
  label?: string;
  verification?: VerificationSummary;
  formatting?: FormattingSummary;
  /** How heavy this batch was, and how heavy the project is after it. */
  weight?: WriteWeight;
  rolledBackAt?: string;
}

/** Trims a user-supplied label into something safe to store and show. */
function sanitizeLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Newest first. The order is what makes "roll back to this moment" meaningful. */
function orderedManifests(): Array<{ manifest: BackupManifest; backupDir: string }> {
  const dir = getBackupRoot();
  if (!fs.existsSync(dir)) return [];
  const items: Array<{ manifest: BackupManifest; backupDir: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      const backupDir = path.join(dir, entry.name);
      const manifest: BackupManifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
      if (manifest?.id) items.push({ manifest, backupDir });
    } catch {
      // A half-written backup must not break the timeline.
    }
  }
  return items.sort((a, b) => {
    if (a.manifest.createdAt === b.manifest.createdAt) return a.manifest.id < b.manifest.id ? 1 : -1;
    return a.manifest.createdAt < b.manifest.createdAt ? 1 : -1;
  });
}

function writeManifest(backupDir: string, manifest: BackupManifest): void {
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

/** The whole history of writes into this folder, newest first — the timeline in the UI. */
export function listBackups(limit = 10): BackupSummary[] {
  return orderedManifests()
    .slice(0, limit)
    .map(({ manifest }) => ({
      id: manifest.id,
      createdAt: manifest.createdAt,
      root: manifest.root,
      fileCount: manifest.entries.length,
      applied: manifest.results.filter((r) => r.status !== 'failed' && r.status !== 'skipped').length,
      failed: manifest.results.filter((r) => r.status === 'failed').length,
      paths: manifest.entries.map((entry) => entry.path),
      label: manifest.label,
      verification: manifest.verification,
      formatting: manifest.formatting,
      weight: manifest.weight,
      rolledBackAt: manifest.rolledBackAt
    }));
}

/** Records the check result next to the batch it belongs to. */
export function attachVerification(changesetId: string | null, summary: VerificationSummary): BackupSummary[] {
  const items = orderedManifests();
  const target = changesetId ? items.find((item) => item.manifest.id === changesetId) : items[0];
  if (target) writeManifest(target.backupDir, { ...target.manifest, verification: summary });
  return listBackups(25);
}

/** Records the tidy-up next to the batch it belongs to, the same way. */
export function attachFormatting(changesetId: string | null, summary: FormattingSummary): BackupSummary[] {
  const items = orderedManifests();
  const target = changesetId ? items.find((item) => item.manifest.id === changesetId) : items[0];
  if (target) writeManifest(target.backupDir, { ...target.manifest, formatting: summary });
  return listBackups(25);
}

/** Records how heavy the batch was, on the same row of the timeline. */
export function attachWeight(changesetId: string | null, weight: WriteWeight): BackupSummary[] {
  const items = orderedManifests();
  const target = changesetId ? items.find((item) => item.manifest.id === changesetId) : items[0];
  if (target) writeManifest(target.backupDir, { ...target.manifest, weight });
  return listBackups(25);
}

/* ------------------------------------------------------------------ *
 * Checkpoints: named moments in the timeline you can jump back to.
 * ------------------------------------------------------------------ */

export interface CheckpointMarker {
  id: string;
  name: string;
  createdAt: string;
  /** The batch that was the newest when the checkpoint was taken (null = before any batch). */
  changesetId: string | null;
}

interface CheckpointFile {
  version: 1;
  items: CheckpointMarker[];
}

function getCheckpointFilePath(): string {
  return path.join(getBackupRoot(), 'checkpoints.json');
}

function readCheckpointFile(): CheckpointFile {
  try {
    const filePath = getCheckpointFilePath();
    if (!fs.existsSync(filePath)) return { version: 1, items: [] };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const items: CheckpointMarker[] = Array.isArray(parsed?.items)
      ? parsed.items
          .filter((item: any) => item && typeof item.id === 'string' && typeof item.name === 'string')
          .map((item: any) => ({
            id: item.id,
            name: String(item.name).slice(0, 80),
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
            changesetId: typeof item.changesetId === 'string' ? item.changesetId : null
          }))
      : [];
    return { version: 1, items };
  } catch {
    return { version: 1, items: [] };
  }
}

function writeCheckpointFile(file: CheckpointFile): void {
  const filePath = getCheckpointFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
}

/** Newest first, matching the timeline. */
export function listCheckpoints(limit = 20): CheckpointMarker[] {
  return readCheckpointFile()
    .items.slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit);
}

/**
 * Marks the current state of the project. Rolling back to it later undoes exactly the batches
 * that came after, so a user can gamble on a risky change and still get back to a known good
 * state without understanding git.
 */
export function createCheckpoint(name: unknown): { checkpoint: CheckpointMarker; checkpoints: CheckpointMarker[] } {
  requireWorkspaceRoot();
  const file = readCheckpointFile();
  const label = sanitizeLabel(name) || `Checkpoint ${file.items.length + 1}`;
  const newest = orderedManifests()[0]?.manifest.id ?? null;
  const checkpoint: CheckpointMarker = {
    id: `cp-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`,
    name: label,
    createdAt: new Date().toISOString(),
    changesetId: newest
  };
  file.items.push(checkpoint);
  writeCheckpointFile(file);
  return { checkpoint, checkpoints: listCheckpoints() };
}

export function deleteCheckpoint(id: unknown): CheckpointMarker[] {
  const target = String(id ?? '');
  const file = readCheckpointFile();
  writeCheckpointFile({ ...file, items: file.items.filter((item) => item.id !== target) });
  return listCheckpoints();
}

export interface RollbackResult {
  checkpointId: string;
  checkpointName: string;
  undoneChangesets: number;
  applied: number;
  failed: number;
  results: FileChangeResult[];
  timeline: BackupSummary[];
}

/**
 * Puts the project back to a checkpoint by undoing every batch that came after it, newest
 * first. Each undo restores its own files to the state they had before that batch, so
 * chaining them lands exactly on the state the checkpoint marked.
 */
export function rollbackToCheckpoint(checkpointId: unknown): RollbackResult {
  requireWorkspaceRoot();
  const marker = readCheckpointFile().items.find((item) => item.id === String(checkpointId ?? ''));
  if (!marker) {
    throw new WorkspaceError('unknown_backup', 'That checkpoint cannot be found.');
  }

  const order = orderedManifests();
  let toUndo: Array<{ manifest: BackupManifest; backupDir: string }>;

  if (!marker.changesetId) {
    toUndo = order.slice();
  } else {
    const targetIndex = order.findIndex((item) => item.manifest.id === marker.changesetId);
    if (targetIndex < 0) {
      throw new WorkspaceError('unknown_backup', 'The history for this checkpoint is no longer available.');
    }
    toUndo = order.slice(0, targetIndex);
  }

  const results: FileChangeResult[] = [];
  let undone = 0;

  for (const item of toUndo) {
    const undoneResult = undoFileChanges(item.manifest.id);
    results.push(...undoneResult.results);
    if (undoneResult.results.some((result) => result.status === 'failed')) {
      // Leave the marker off this batch: it is not cleanly undone, and the user must see that.
      continue;
    }
    undone += 1;
    writeManifest(item.backupDir, { ...item.manifest, rolledBackAt: new Date().toISOString() });
  }

  return {
    checkpointId: marker.id,
    checkpointName: marker.name,
    undoneChangesets: undone,
    applied: results.filter((r) => r.status !== 'failed' && r.status !== 'skipped').length,
    failed: results.filter((r) => r.status === 'failed').length,
    results,
    timeline: listBackups(25)
  };
}

/** Directory listing for the in-app folder picker (folders only, one level at a time). */
export interface BrowseEntry {
  name: string;
  path: string;
}

export interface BrowseResult {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
  roots: BrowseEntry[];
}

function listWindowsDrives(): BrowseEntry[] {
  const drives: BrowseEntry[] = [];
  for (let code = 65; code <= 90; code++) {
    const letter = String.fromCharCode(code);
    const drivePath = `${letter}:\\`;
    try {
      if (fs.existsSync(drivePath)) drives.push({ name: drivePath, path: drivePath });
    } catch {
      // Some drive letters are reserved but unreadable — ignore them.
    }
  }
  return drives;
}

function quickAccessEntries(): BrowseEntry[] {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (!home) return [];
  const candidates = [
    { name: 'Desktop', path: path.join(home, 'Desktop') },
    { name: 'Documents', path: path.join(home, 'Documents') },
    { name: 'Downloads', path: path.join(home, 'Downloads') }
  ];
  return candidates.filter((c) => {
    try {
      return fs.existsSync(c.path) && fs.statSync(c.path).isDirectory();
    } catch {
      return false;
    }
  });
}

export function browseFolders(requestedDir: unknown): BrowseResult {
  const requested = typeof requestedDir === 'string' ? requestedDir.trim() : '';
  const roots: BrowseEntry[] =
    process.platform === 'win32'
      ? [...quickAccessEntries(), ...listWindowsDrives()]
      : [{ name: '/', path: '/' }, ...quickAccessEntries()];

  if (!requested) {
    return { path: '', parent: null, entries: [], roots };
  }

  const target = path.resolve(requested);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    throw new WorkspaceError('not_found', `The folder does not exist: ${target}`);
  }

  let entries: BrowseEntry[] = [];
  try {
    entries = fs
      .readdirSync(target, { withFileTypes: true })
      .filter((entry) => {
        try {
          return entry.isDirectory() && !entry.isSymbolicLink() && !IGNORED_DIRS.has(entry.name);
        } catch {
          return false;
        }
      })
      .map((entry) => ({ name: entry.name, path: path.join(target, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    throw new WorkspaceError('not_writable', `The folder cannot be opened: ${target}`);
  }

  const parent = path.dirname(target);
  return {
    path: target,
    parent: parent === target ? null : parent,
    entries,
    roots
  };
}
