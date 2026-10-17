import fs from 'fs';
import path from 'path';

/**
 * Remembers the single real project folder the user connected to the app.
 *
 * Everything that touches the disk goes through here, so the bound folder is the only
 * place the app can ever read or write — the AI can never escape to C:\Windows or an
 * SSH key just because it produced an absolute path.
 */

export type WorkspaceErrorCode =
  | 'no_workspace'
  | 'empty_path'
  | 'not_found'
  | 'not_a_directory'
  | 'not_writable'
  | 'outside_root'
  | 'sensitive_file'
  | 'too_large'
  | 'no_changes'
  | 'unknown_backup'
  | 'nothing_to_fix'
  | 'no_checks';

export class WorkspaceError extends Error {
  constructor(public code: WorkspaceErrorCode, message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

interface StoreFileShape {
  version: 1;
  root: string | null;
  updatedAt: string | null;
}

let boundRoot: string | null = null;
let loaded = false;

export function getStoreFilePath(): string {
  // Tests point this at a temp file so they never touch the developer's real workspace.
  return process.env.EPC_WORKSPACE_FILE || path.join(process.cwd(), 'data', 'workspace.json');
}

/** Backups live next to the app's own data, never inside the user's project folder. */
export function getBackupRoot(): string {
  return process.env.EPC_WORKSPACE_BACKUP_DIR || path.join(process.cwd(), 'data', 'workspace-backups');
}

function readStoreFile(): StoreFileShape {
  try {
    const filePath = getStoreFilePath();
    if (!fs.existsSync(filePath)) return { version: 1, root: null, updatedAt: null };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const root = typeof parsed?.root === 'string' && parsed.root.trim() ? parsed.root : null;
    return {
      version: 1,
      root,
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null
    };
  } catch {
    console.warn('[Workspace] Could not read the saved workspace, starting without a folder.');
    return { version: 1, root: null, updatedAt: null };
  }
}

function writeStoreFile(): void {
  const filePath = getStoreFilePath();
  const payload: StoreFileShape = { version: 1, root: boundRoot, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8' });
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  const parsed = readStoreFile();
  // A folder that was moved or deleted since the last run must not stay "connected".
  if (parsed.root && fs.existsSync(parsed.root)) boundRoot = path.resolve(parsed.root);
}

/** Called once on boot, mirrors initApiKeyStore(). */
export function initWorkspaceStore(): void {
  ensureLoaded();
}

export function getWorkspaceRoot(): string | null {
  ensureLoaded();
  return boundRoot;
}

/** Users copy folder paths out of Explorer, so strip quotes and trailing separators. */
export function normalizeFolderPath(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\r\n\t]/g, '')
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[\\/]+$/, '');
}

export function bindWorkspace(folderPath: unknown): { root: string; fileCount: number } {
  const normalized = normalizeFolderPath(folderPath);
  if (!normalized) {
    throw new WorkspaceError('empty_path', 'Enter the path of your project folder.');
  }
  const resolved = path.resolve(normalized);
  if (!fs.existsSync(resolved)) {
    throw new WorkspaceError('not_found', `The folder does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new WorkspaceError('not_a_directory', `This is a file, not a folder: ${resolved}`);
  }
  try {
    fs.accessSync(resolved, fs.constants.W_OK);
  } catch {
    throw new WorkspaceError('not_writable', `The folder is read-only: ${resolved}`);
  }

  boundRoot = resolved;
  writeStoreFile();
  return { root: resolved, fileCount: 0 };
}

export function unbindWorkspace(): void {
  boundRoot = null;
  writeStoreFile();
}

export function requireWorkspaceRoot(): string {
  const root = getWorkspaceRoot();
  if (!root) {
    throw new WorkspaceError('no_workspace', 'No project folder is connected yet. Choose your folder first.');
  }
  return root;
}

/**
 * Files the app must never read out loud or overwrite: keys, certificates and anything
 * that looks like a secret. Reading them would ship the user's credentials to the AI provider.
 */
const SENSITIVE_BASENAME_PATTERNS: RegExp[] = [
  /^\.env(\..*)?$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.git-credentials$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i,
  /\.(pem|key|pfx|p12|keystore|jks|ppk)$/i,
  /(secret|credential|api[-_]?key|access[-_]?token|private[-_]?key)/i
];

export function isSensitiveRelativePath(relativePath: string): boolean {
  const segments = relativePath.split('/').filter(Boolean);
  return segments.some((segment) => SENSITIVE_BASENAME_PATTERNS.some((pattern) => pattern.test(segment)));
}

/** Converts an absolute path inside the workspace back into a relative, forward-slash path. */
export function toRelativePath(absolutePath: string): string {
  const root = requireWorkspaceRoot();
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

/**
 * Resolves a path the user or the AI supplied and refuses anything outside the bound folder,
 * anything sensitive, and any path that is not a normal relative path.
 */
export function resolveWorkspacePath(relativePath: unknown, options: { allowSensitive?: boolean } = {}): string {
  const root = requireWorkspaceRoot();
  if (typeof relativePath !== 'string') {
    throw new WorkspaceError('empty_path', 'The change has no file path.');
  }
  const cleaned = relativePath.replace(/\\/g, '/').trim().replace(/^\.\//, '').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('\0') || cleaned === '.') {
    throw new WorkspaceError('empty_path', 'The change has no valid file path.');
  }
  if (/^[a-zA-Z]:/.test(cleaned)) {
    throw new WorkspaceError('outside_root', `Absolute paths are not allowed: ${relativePath}`);
  }

  const absolute = path.resolve(root, cleaned);
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new WorkspaceError('outside_root', `This path is outside your project folder: ${relativePath}`);
  }


  const normalized = relative.split(path.sep).join('/');
  if (!options.allowSensitive && isSensitiveRelativePath(normalized)) {
    throw new WorkspaceError('sensitive_file', `Files that look like secrets are protected: ${normalized}`);
  }
  return absolute;
}

/** Test helper: drops in-memory state without touching the file on disk. */
export function resetWorkspaceStoreForTests(): void {
  boundRoot = null;
  loaded = true;
}
