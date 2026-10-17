import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { isSensitiveRelativePath, resolveWorkspacePath } from '../store/workspaceStore';

/**
 * Git, the last piece of the loop: the app writes files into the real folder, so it can also
 * save a version of them — with the user's own Git, on the user's own machine.
 *
 * Three rules shape everything here:
 *  - local only. Nothing in this module can reach a network: there is no `push`, no `fetch`,
 *    no `pull`, and `GIT_TERMINAL_PROMPT=0` so Git can never stop to ask for a password.
 *  - only what Git already reports. A commit takes paths straight out of `git status`, so a
 *    path coming from the AI or from a hand-typed string can never be committed.
 *  - never in the middle of the user's work: a commit is path-limited (`git commit -- <paths>`),
 *    so changes the user staged in another file stay staged and out of this commit.
 */

export type GitFileState =
  | 'untracked'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'conflicted'
  | 'typechange';

export interface GitFileStatus {
  /** Path relative to the connected folder, forward slashes — what the screen shows. */
  path: string;
  state: GitFileState;
  /** The raw two-letter porcelain code ("M ", " M", "??"), kept for the detail line. */
  code: string;
  staged: boolean;
  untracked: boolean;
  /** Tracked config that looks like a secret: listed, but its contents are never printed. */
  sensitive: boolean;
}

export interface GitStatusResult {
  available: boolean;
  isRepo: boolean;
  branch: string | null;
  /** The branch this one tracks, when it tracks one. Nothing is ever fetched, so it is a prefix. */
  upstream: string | null;
  /**
   * Commits this branch has that its upstream does not, and the other way round.
   *
   * Null when there is no upstream at all: a folder that only exists on this computer has nowhere
   * to be ahead of, and "0 ahead" would be a quiet lie about work that was never sent anywhere.
   */
  ahead: number | null;
  behind: number | null;
  clean: boolean;
  files: GitFileStatus[];
  /** Git has no user.name / user.email yet, so a commit would be refused by Git itself. */
  identityMissing: boolean;
  /** Set when Git could not be inspected at all (missing binary, damaged repository). */
  message: string | null;
}

export interface GitDiffResult {
  path: string;
  diff: string;
  truncated: boolean;
  binary: boolean;
  /** 'sensitive' means the file is listed but its contents are deliberately not shown. */
  note: 'sensitive' | 'empty' | null;
}

export interface GitCommitResult {
  hash: string;
  subject: string;
  committed: string[];
  /** Files that were left alone because they were not selected — reported, never touched. */
  remaining: string[];
}

/** One local branch, as the picker shows it. */
export interface GitBranchInfo {
  name: string;
  current: boolean;
  /** The branch it tracks, when it tracks one. Null for a branch that only exists here. */
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  /** Short id of the commit it points at, so two branches at the same commit are recognisable. */
  tip: string;
}

export interface GitBranchesResult {
  available: boolean;
  isRepo: boolean;
  current: string | null;
  branches: GitBranchInfo[];
  /** The branch this one grew out of, offered as the default base for a comparison. */
  suggestedBase: string | null;
  /** True when Git is in the middle of a merge, rebase or cherry-pick: no branch is created then. */
  operationInProgress: string | null;
  message: string | null;
}

/**
 * What one branch has that another does not.
 *
 * Compared with `base...HEAD`, which is the question people actually ask about a branch —
 * "what did this branch add?" — and not the difference between two snapshots that may have
 * moved apart in unrelated ways.
 */
export interface GitBranchDiffResult {
  base: string;
  head: string;
  files: Array<{
    path: string;
    state: 'added' | 'modified' | 'deleted' | 'renamed';
    additions: number;
    deletions: number;
  }>;
  additions: number;
  deletions: number;
  patch: string;
  truncated: boolean;
  /** True when the branch has nothing the base does not have. */
  same: boolean;
}

export interface GitCreateBranchInput {
  name: unknown;
}

export interface GitCreateBranchResult {
  branch: string;
  previous: string | null;
  /** The commit the new branch starts from — the same one the previous branch pointed at. */
  fromCommit: string;
  /** Files still uncommitted that came along, because a branch does not touch the worktree. */
  carriedChanges: number;
}

export type GitErrorCode =
  | 'no_git'
  | 'not_a_repo'
  | 'nothing_selected'
  | 'unknown_path'
  | 'no_changes'
  | 'identity_missing'
  | 'commit_failed'
  | 'invalid_branch'
  | 'branch_exists'
  | 'unknown_branch'
  | 'branch_failed';


export class GitError extends Error {
  constructor(public code: GitErrorCode, message: string, public detail?: string) {
    super(message);
    this.name = 'GitError';
  }
}

const READ_TIMEOUT_MS = 20_000;
const COMMIT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 400_000;
const MAX_DIFF_CHARS = 200_000;
const MAX_UNTRACKED_FILE_BYTES = 400_000;
const MAX_COMMIT_FILES = 200;
const MAX_MESSAGE_CHARS = 2000;
const MAX_BRANCH_CHARS = 128;
const MAX_BRANCH_DIFF_FILES = 500;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

let gitVersionCache: string | null | undefined;

/** Is Git installed at all? Answered once, because the answer cannot change mid-session. */
export function gitVersion(): string | null {
  if (gitVersionCache !== undefined) return gitVersionCache;
  const probe = spawnSync('git', ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });
  const text = `${probe.stdout || ''}${probe.stderr || ''}`.trim();
  gitVersionCache = probe.status === 0 && text ? text : null;
  return gitVersionCache;
}

export function gitAvailable(): boolean {
  return gitVersion() !== null;
}

/** Test helper: forget the cached probe so a stubbed environment can be re-checked. */
export function resetGitProbeForTests(): void {
  gitVersionCache = undefined;
}

/**
 * Runs Git with an argument array (never a shell string) from one folder. Every call is bounded
 * in time and output, so a huge repository or a slow disk reports an error instead of hanging
 * the request.
 */
function runGit(args: string[], cwd: string, timeoutMs = READ_TIMEOUT_MS): RunResult {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: MAX_OUTPUT_CHARS * 4,
    env: {
      ...process.env,
      // No credential prompt, no pager, no color: this is a machine, not a terminal.
      GIT_TERMINAL_PROMPT: '0',
      GIT_PAGER: 'cat',
      GIT_OPTIONAL_LOCKS: '0'
    }
  });

  const timedOut = result.error ? (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' : false;
  return {
    code: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr:
      (typeof result.stderr === 'string' ? result.stderr : '') ||
      (result.error && !timedOut ? String(result.error.message || result.error) : ''),
    timedOut
  };
}

function toPosix(value: string): string {
  return value.split('\\').join('/');
}

/** Where the repository actually begins, and how the connected folder sits inside it. */
interface RepoLocation {
  top: string;
  /** '' when the connected folder *is* the repository root; otherwise 'src/app' style. */
  prefix: string;
}

function locateRepo(root: string): RepoLocation | null {
  const top = runGit(['rev-parse', '--show-toplevel'], root);
  if (top.code !== 0 || !top.stdout.trim()) return null;
  const topLevel = top.stdout.trim().replace(/[\r\n]+$/, '');
  if (!topLevel) return null;

  const relative = toPosix(path.relative(topLevel, root));
  return { top: topLevel, prefix: relative === '.' ? '' : relative };
}

function mapState(code: string): GitFileState {
  if (code === '??') return 'untracked';
  if (code === '!!') return 'untracked';
  const worktree = code[1];
  const index = code[0];
  if (index === 'U' || worktree === 'U' || code === 'AA' || code === 'DD') return 'conflicted';
  if (worktree === 'M' || index === 'M') return 'modified';
  if (worktree === 'D' || index === 'D') return 'deleted';
  if (worktree === 'R' || index === 'R') return 'renamed';
  if (worktree === 'T' || index === 'T') return 'typechange';
  if (worktree === 'A' || index === 'A') return 'added';
  return 'modified';
}

/**
 * Parses `git status --porcelain=v1 -z`. Records are NUL-separated, so file names may contain
 * spaces, quotes and newlines without breaking anything. `--no-renames` keeps one path per
 * record (a rename is reported as a deletion plus an addition), which is what a path-limited
 * commit can act on anyway.
 */
function parsePorcelainZ(stdout: string): Array<{ code: string; repoPath: string }> {
  const entries: Array<{ code: string; repoPath: string }> = [];
  for (const record of stdout.split('\0')) {
    if (record.length < 4) continue;
    const code = record.slice(0, 2);
    const repoPath = record.slice(3);
    if (!repoPath) continue;
    entries.push({ code, repoPath: toPosix(repoPath) });
  }
  return entries;
}

/**
 * Everything the Git panel draws: which repository the folder is in, what changed, and whether
 * Git is even usable here. A folder that is not a repository is a normal answer, not an error.
 */
export function getGitStatus(root: string): GitStatusResult {
  const empty: GitStatusResult = {
    available: false,
    isRepo: false,
    branch: null,
    upstream: null,
    ahead: null,
    behind: null,
    clean: true,
    files: [],
    identityMissing: false,
    message: null
  };

  if (!gitAvailable()) {
    return { ...empty, message: 'git_missing' };
  }

  const repo = locateRepo(root);
  if (!repo) {
    return { ...empty, available: true, message: 'not_a_repo' };
  }

  const status = runGit(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'],
    repo.top
  );

  if (status.code !== 0) {
    return { ...empty, available: true, isRepo: true, message: 'status_failed' };
  }

  const files: GitFileStatus[] = [];
  for (const entry of parsePorcelainZ(status.stdout)) {
    const insidePrefix =
      repo.prefix === '' ||
      entry.repoPath === repo.prefix ||
      entry.repoPath.startsWith(`${repo.prefix}/`);
    if (!insidePrefix) continue;
    // A connected folder that *is* the repository cannot contain '.git' entries, but a
    // connected subfolder next to another repository can — those are not the user's changes.
    if (entry.repoPath.split('/').includes('.git')) continue;

    const displayPath = repo.prefix ? entry.repoPath.slice(repo.prefix.length + 1) : entry.repoPath;
    if (!displayPath || displayPath.split('/').includes('node_modules')) continue;

    files.push({
      path: displayPath,
      state: mapState(entry.code),
      code: entry.code,
      staged: entry.code !== '??' && entry.code[0] !== ' ',
      untracked: entry.code === '??',
      sensitive: isSensitiveRelativePath(displayPath)
    });
  }

  files.sort((a, b) => a.path.localeCompare(b.path));

  const email = runGit(['config', '--get', 'user.email'], repo.top);
  const name = runGit(['config', '--get', 'user.name'], repo.top);
  const identityMissing = !email.stdout.trim() || !name.stdout.trim();
  const tracking = readTracking(repo.top);

  return {
    available: true,
    isRepo: true,
    branch: readBranch(repo.top),
    upstream: tracking.upstream,
    ahead: tracking.ahead,
    behind: tracking.behind,
    clean: files.length === 0,
    files,
    identityMissing,
    message: null
  };
}

interface BranchTracking {
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
}

/**
 * Where this branch stands compared with the copy it tracks.
 *
 * The app never fetches, pulls or pushes, so these numbers describe the last known state of the
 * upstream on this computer — which is exactly what "2 versions you have not sent anywhere"
 * means for someone whose only remote is their own machine. Without an upstream there is nothing
 * to stand in front of, so both counts are null instead of a reassuring zero.
 */
function readTracking(top: string): BranchTracking {
  const name = runGit(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], top);
  const upstream = name.code === 0 ? name.stdout.trim() : '';
  if (!upstream) return { upstream: null, ahead: null, behind: null };

  // --left-right --count prints "<left>\t<right>": the branch's own commits, then the upstream's.
  const counts = runGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], top);
  if (counts.code !== 0) return { upstream, ahead: null, behind: null };

  const [aheadRaw, behindRaw] = counts.stdout.trim().split(/\s+/);
  const ahead = Number.parseInt(aheadRaw, 10);
  const behind = Number.parseInt(behindRaw, 10);
  return {
    upstream,
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null
  };
}

/**
 * Validates a branch name the way Git itself would, in both directions.
 *
 * Nothing here is a guess: the name is rejected if it could be read as a Git option, and then
 * handed to `git check-ref-format --branch`, which is Git's own answer to "is this a branch name?".
 */
function normalizeBranchName(value: unknown): string {
  const name = String(value ?? '').trim();
  if (!name) throw new GitError('invalid_branch', 'No branch name was given.');
  if (name.length > MAX_BRANCH_CHARS) {
    throw new GitError('invalid_branch', 'That branch name is too long.');
  }
  if (name.startsWith('-') || /[\s~^:?*\\\[\]\0]/.test(name) || name.includes('..') || name.includes('@{')) {
    throw new GitError(
      'invalid_branch',
      'A branch name cannot start with "-" or contain spaces, ~ ^ : ? * [ \\ ] or "..".'
    );
  }
  if (name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock') || name.includes('//')) {
    throw new GitError('invalid_branch', 'That is not a name Git accepts for a branch.');
  }
  return name;
}

/**
 * The branches of this repository, and which one is checked out.
 *
 * Listing branches is a read: nothing here switches, merges or deletes. The last branch that is
 * not the current one becomes the suggested base for a comparison, which is the useful default —
 * "everything my work has and main does not".
 */
export function getGitBranches(root: string): GitBranchesResult {
  const empty: GitBranchesResult = {
    available: false,
    isRepo: false,
    current: null,
    branches: [],
    suggestedBase: null,
    operationInProgress: null,
    message: null
  };

  if (!gitAvailable()) return { ...empty, message: 'git_missing' };
  const repo = locateRepo(root);
  if (!repo) return { ...empty, available: true, message: 'not_a_repo' };

  const current = readBranch(repo.top);
  const listed = runGit(
    [
      'for-each-ref',
      '--format=%(refname:short)%09%(upstream:short)%09%(objectname:short)',
      '--sort=-committerdate',
      'refs/heads'
    ],
    repo.top
  );
  if (listed.code !== 0) return { ...empty, available: true, isRepo: true, message: 'status_failed' };

  const branches: GitBranchInfo[] = [];
  for (const line of listed.stdout.split(/\r?\n/)) {
    const [name, upstream, tip] = line.split('\t');
    if (!name) continue;
    const isCurrent = current !== null && name === current;
    const tracking: BranchTracking = upstream
      ? readTrackingOf(repo.top, name)
      : { upstream: null, ahead: null, behind: null };
    branches.push({
      name,
      current: isCurrent,
      upstream: tracking.upstream,
      ahead: tracking.ahead,
      behind: tracking.behind,
      tip: tip || ''
    });
  }

  return {
    available: true,
    isRepo: true,
    current,
    branches,
    suggestedBase: branches.find((branch) => !branch.current)?.name || null,
    operationInProgress: readGitOperation(repo.top),
    message: null
  };
}

/** The same numbers as `readTracking`, asked about a branch that is not the checked-out one. */
function readTrackingOf(top: string, branch: string): BranchTracking {
  const name = runGit(
    ['for-each-ref', '--format=%(upstream:short)', `refs/heads/${branch}`],
    top
  );
  const upstream = name.code === 0 ? name.stdout.trim() : '';
  if (!upstream) return { upstream: null, ahead: null, behind: null };

  const counts = runGit(['rev-list', '--left-right', '--count', `${branch}...${upstream}`], top);
  if (counts.code !== 0) return { upstream, ahead: null, behind: null };
  const [aheadRaw, behindRaw] = counts.stdout.trim().split(/\s+/);
  const ahead = Number.parseInt(aheadRaw, 10);
  const behind = Number.parseInt(behindRaw, 10);
  return {
    upstream,
    ahead: Number.isFinite(ahead) ? ahead : null,
    behind: Number.isFinite(behind) ? behind : null
  };
}

/**
 * Whether Git is in the middle of something that a branch switch would wreck.
 *
 * The app creates a branch for an agent's work, and doing that during a conflicted merge is how
 * a beginner loses the merge they were halfway through — so it is reported instead.
 */
function readGitOperation(top: string): string | null {
  const gitDir = runGit(['rev-parse', '--git-dir'], top);
  if (gitDir.code !== 0) return null;
  const dir = path.resolve(top, gitDir.stdout.trim());
  const markers: Array<[string, string]> = [
    ['MERGE_HEAD', 'merge'],
    ['rebase-merge', 'rebase'],
    ['rebase-apply', 'rebase'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'],
    ['REVERT_HEAD', 'revert'],
    ['BISECT_LOG', 'bisect']
  ];
  for (const [marker, label] of markers) {
    try {
      if (fs.existsSync(path.join(dir, marker))) return label;
    } catch {
      // An unreadable marker simply is not a marker.
    }
  }
  return null;
}

/**
 * Starts a branch for the work that is about to happen.
 *
 * Two things make this safe to offer to a beginner:
 *  - it never moves a commit. The new branch starts exactly where the current one points, so
 *    nothing that was saved can be lost by pressing the button;
 *  - it never decides anything about the working tree. Files that are not committed yet come
 *    along, and the answer says how many — because "I started a branch and now the app is on a
 *    different branch" is exactly the kind of surprise that has to be reported, not hidden.
 *
 * There is no delete, no merge and no switch in this module: only creating a branch, and only
 * from the name the user typed (validated by Git itself).
 */
export function createGitBranch(root: string, input: GitCreateBranchInput): GitCreateBranchResult {
  if (!gitAvailable()) throw new GitError('no_git', 'Git is not installed.');
  const repo = locateRepo(root);
  if (!repo) throw new GitError('not_a_repo', 'This folder is not a Git repository.');

  const name = normalizeBranchName(input?.name);

  const check = runGit(['check-ref-format', '--branch', name], repo.top);
  if (check.code !== 0) {
    throw new GitError('invalid_branch', 'Git does not accept this branch name.', tail(`${check.stdout}${check.stderr}`));
  }

  const existing = runGit(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], repo.top);
  if (existing.code === 0) {
    throw new GitError('branch_exists', `A branch called "${name}" already exists here.`);
  }

  const operation = readGitOperation(repo.top);
  if (operation) {
    throw new GitError(
      'branch_failed',
      `Git is in the middle of a ${operation}. Finish or stop it in a terminal before starting a branch.`
    );
  }

  const previous = readBranch(repo.top);
  const created = runGit(['checkout', '-b', name], repo.top, COMMIT_TIMEOUT_MS);
  if (created.code !== 0) {
    throw new GitError(
      'branch_failed',
      'Git could not start this branch.',
      tail(`${created.stdout}${created.stderr}`)
    );
  }

  const tip = runGit(['rev-parse', '--short', 'HEAD'], repo.top);
  const after = getGitStatus(root);

  return {
    branch: name,
    previous: previous && previous !== name ? previous : null,
    fromCommit: tip.stdout.trim(),
    carriedChanges: after.files.length
  };
}

/**
 * What one branch has that another does not.
 *
 * Both names are checked against the repository's own list first, so a ref cannot be smuggled in
 * through the request, and the comparison is read-only: no checkout, no merge, no writes.
 */
export function getGitBranchDiff(root: string, baseValue: unknown): GitBranchDiffResult {
  if (!gitAvailable()) throw new GitError('no_git', 'Git is not installed.');
  const repo = locateRepo(root);
  if (!repo) throw new GitError('not_a_repo', 'This folder is not a Git repository.');

  const branches = getGitBranches(root).branches;
  const current = readBranch(repo.top);
  const names = new Set(branches.map((branch) => branch.name));

  const base = String(baseValue ?? '').trim();
  if (!base || !names.has(base)) {
    throw new GitError('unknown_branch', 'There is no such branch in this repository.');
  }
  if (!current || !names.has(current)) {
    throw new GitError('unknown_branch', 'This folder is not on a branch right now.');
  }

  const sameTip = runGit(['rev-parse', `${base}^{commit}`, `${current}^{commit}`], repo.top);
  const [baseTip = '', currentTip = ''] = sameTip.stdout.trim().split(/\r?\n/);
  const same = Boolean(baseTip) && baseTip === currentTip;

  const numstat = runGit(
    ['diff', '--numstat', '--no-renames', '--no-color', `${base}...${current}`, ...pathspec(repo)],
    repo.top
  );
  const patchResult = runGit(
    ['diff', '--no-color', '--no-ext-diff', '--no-textconv', `${base}...${current}`, ...pathspec(repo)],
    repo.top
  );

  const files: GitBranchDiffResult['files'] = [];
  let additions = 0;
  let deletions = 0;
  for (const line of numstat.stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [addedRaw, removedRaw, ...pathParts] = line.split('\t');
    const repoPath = pathParts.join('\t');
    if (!repoPath) continue;
    // Only the connected folder's own files: a repository may hold more than this project.
    if (repo.prefix && !repoPath.startsWith(`${repo.prefix}/`)) continue;
    const displayPath = repo.prefix ? repoPath.slice(repo.prefix.length + 1) : repoPath;
    const binaryFile = addedRaw === '-' || removedRaw === '-';
    const added = binaryFile ? 0 : Number.parseInt(addedRaw, 10) || 0;
    const removed = binaryFile ? 0 : Number.parseInt(removedRaw, 10) || 0;
    additions += added;
    deletions += removed;
    files.push({
      path: displayPath,
      state: binaryFile ? 'modified' : removed === 0 ? 'added' : added === 0 ? 'deleted' : 'modified',
      additions: added,
      deletions: removed
    });
  }
  files.sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));

  const rawPatch = patchResult.stdout;
  const truncated = rawPatch.length > MAX_DIFF_CHARS;
  const patch = truncated ? `${rawPatch.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated)` : rawPatch;

  return {
    base,
    head: current,
    files: files.slice(0, MAX_BRANCH_DIFF_FILES),
    additions,
    deletions,
    patch,
    truncated,
    same
  };
}

/** A readable branch name; a detached HEAD falls back to the short commit id. */
function readBranch(top: string): string | null {
  const symbolic = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], top);
  if (symbolic.code === 0 && symbolic.stdout.trim()) return symbolic.stdout.trim();

  const detached = runGit(['rev-parse', '--short', 'HEAD'], top);
  if (detached.code === 0 && detached.stdout.trim()) return `(${detached.stdout.trim()})`;
  return null;
}

/**
 * The diff for one file, exactly as Git prints it. An untracked file has no diff yet, so its
 * content is shown as additions — the same thing `git add -N` would produce, but without
 * touching the index.
 */
export function getGitDiff(root: string, relativePath: unknown): GitDiffResult {
  const relPath = normalizeRelative(relativePath);
  if (!gitAvailable()) throw new GitError('no_git', 'Git is not installed.');
  const repo = locateRepo(root);
  if (!repo) throw new GitError('not_a_repo', 'This folder is not a Git repository.');

  if (isSensitiveRelativePath(relPath)) {
    return { path: relPath, diff: '', truncated: false, binary: false, note: 'sensitive' };
  }

  // The path is validated against the connected folder before anything is read or spawned.
  resolveWorkspacePath(relPath);
  const repoPath = repo.prefix ? `${repo.prefix}/${relPath}` : relPath;

  for (const args of [
    ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--', repoPath],
    ['diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--', repoPath]
  ]) {
    const result = runGit(args, repo.top);
    if (result.code === 0 && result.stdout.trim()) return shapeDiff(relPath, result.stdout);
  }

  // Nothing in the index or the worktree diff means the file is new and never added.
  return shapeDiff(relPath, buildUntrackedDiff(root, relPath));
}

function shapeDiff(relPath: string, raw: string): GitDiffResult {
  const binary = /^Binary files |^GIT binary patch/m.test(raw);
  const truncated = raw.length > MAX_DIFF_CHARS;
  const diff = truncated ? `${raw.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated)` : raw;
  return {
    path: relPath,
    diff,
    truncated,
    binary,
    note: diff.trim() ? null : 'empty'
  };
}

/** A diff-shaped view of a file Git has never seen, so the panel can still show its content. */
function buildUntrackedDiff(root: string, relPath: string): string {
  const absolute = resolveWorkspacePath(relPath);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(absolute);
  } catch {
    return '';
  }
  if (!stats.isFile()) return '';
  if (stats.size > MAX_UNTRACKED_FILE_BYTES) return '(file is too large to show here)';

  let content: string;
  try {
    content = fs.readFileSync(absolute, 'utf8');
  } catch {
    return '';
  }
  if (content.includes('\0')) return `Binary file (${stats.size} bytes)`;

  const lines = content.split(/\r\n|\n|\r/);
  // A trailing newline would otherwise add one empty "+" line that is not in the file.
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  const body = lines.map((line) => `+${line}`).join('\n');
  return `--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`;
}

/** The connected folder as a pathspec: a repository can hold more than this project. */
function pathspec(repo: RepoLocation): string[] {
  return ['--', repo.prefix ? repo.prefix : '.'];
}

function normalizeRelative(value: unknown): string {
  if (typeof value !== 'string') throw new GitError('unknown_path', 'No file was given.');
  const cleaned = value.split('\\').join('/').trim().replace(/^\.\//, '').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('\0')) throw new GitError('unknown_path', 'No file was given.');
  return cleaned;
}

export interface GitCommitInput {
  files: unknown;
  message: unknown;
}

/**
 * Commits exactly the selected files, and nothing else.
 *
 * `git commit -- <paths>` is a path-limited commit: it records the working-tree state of those
 * paths and leaves everything else — including what the user staged by hand — untouched. New
 * files have to enter the index first, which is the only index write this module ever makes.
 */
export function commitGitChanges(root: string, input: GitCommitInput): GitCommitResult {
  if (!gitAvailable()) throw new GitError('no_git', 'Git is not installed.');

  const requested = Array.isArray(input.files) ? input.files : [];
  const wanted = new Set(
    requested
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => normalizeRelative(entry))
  );
  if (wanted.size === 0) throw new GitError('nothing_selected', 'No files were selected.');
  if (wanted.size > MAX_COMMIT_FILES) {
    throw new GitError('nothing_selected', `Too many files in one commit (${wanted.size}).`);
  }

  const message = String(input.message ?? '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) throw new GitError('nothing_selected', 'The commit message is empty.');

  const status = getGitStatus(root);
  if (!status.available) throw new GitError('no_git', 'Git is not installed.');
  if (!status.isRepo) throw new GitError('not_a_repo', 'This folder is not a Git repository.');

  // Only paths Git itself reported can be committed: the selection cannot smuggle in a path
  // the user never saw, and it cannot carry a Git option either.
  const byDisplayPath = new Map(status.files.map((file) => [file.path, file]));
  const unknown = [...wanted].filter((path) => !byDisplayPath.has(path));
  if (unknown.length > 0) {
    throw new GitError('unknown_path', `Git does not report these as changed: ${unknown.join(', ')}`);
  }

  const repo = locateRepo(root);
  if (!repo) throw new GitError('not_a_repo', 'This folder is not a Git repository.');

  const selected = [...wanted].map((path) => byDisplayPath.get(path)!);
  const repoPathOf = (path: string) => (repo.prefix ? `${repo.prefix}/${path}` : path);

  const untracked = selected.filter((file) => file.untracked).map((file) => file.path);
  if (untracked.length > 0) {
    const added = runGit(['add', '-A', '--', ...untracked.map(repoPathOf)], repo.top);
    if (added.code !== 0) {
      throw new GitError(
        'commit_failed',
        'Git refused to add these files.',
        tail(`${added.stdout}${added.stderr}`)
      );
    }
  }

  const commit = runGit(
    ['commit', '-m', message, '--only', '--', ...selected.map((file) => repoPathOf(file.path))],
    repo.top,
    COMMIT_TIMEOUT_MS
  );

  if (commit.code !== 0) {
    const text = `${commit.stdout}\n${commit.stderr}`;
    if (/nothing (added )?to commit|no changes added to commit|nothing to commit/i.test(text)) {
      throw new GitError('no_changes', 'There is nothing to commit in the selected files.');
    }
    if (/Please tell me who you are|unable to auto-detect email address|Author identity unknown|empty ident name/i.test(text)) {
      throw new GitError(
        'identity_missing',
        'Git does not know your name and email address yet.',
        tail(text)
      );
    }
    if (commit.timedOut) {
      throw new GitError('commit_failed', 'The commit took too long and was stopped.', tail(text));
    }
    throw new GitError('commit_failed', 'Git could not create the commit.', tail(text));
  }

  const head = runGit(['show', '--no-patch', '--format=%h%n%s', 'HEAD'], repo.top);
  const [hash = '', ...subjectLines] = head.stdout.trim().split(/\r?\n/);
  const subject = subjectLines.join(' ').trim();

  const names = runGit(['show', '--name-only', '--format=', 'HEAD'], repo.top);
  const committed = names.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((repoPath) => repo.prefix === '' || repoPath.startsWith(`${repo.prefix}/`))
    .map((repoPath) => (repo.prefix ? repoPath.slice(repo.prefix.length + 1) : repoPath));

  const after = getGitStatus(root);
  return {
    hash,
    subject,
    committed: committed.length > 0 ? committed : [...wanted],
    remaining: after.files.map((file) => file.path)
  };
}

function tail(text: string, limit = 2000): string {
  const trimmed = text.trim();
  return trimmed.length > limit ? `…${trimmed.slice(-limit)}` : trimmed;
}
