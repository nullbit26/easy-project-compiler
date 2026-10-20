import { inferFileType, readWorkspaceTextFile, scanWorkspace } from './workspaceFiles';
import { resolveWorkspacePath, toRelativePath } from '../store/workspaceStore';
import {
  buildGraph,
  findMentionPaths,
  normalizeGraphPath,
  planContext,
  symbolFromPath,
  type GraphFile,
  type PlanEntry
} from './codeGraph';

/**
 * The folder half of the context plan: it reads, the graph decides, and nothing else.
 *
 * One pass over the folder's text heads is enough to know the imports of every file, because
 * imports live at the top. The full body is read only for the files the plan actually selects, so
 * a large repository costs a few milliseconds instead of a full content read. There is no cache on
 * purpose: a stale graph is a wrong prompt, and rebuilding is cheap enough that invalidation bugs
 * are the worse trade.
 */

/** Enough of a file to see its imports, requires and usings. */
const HEAD_BYTES = 8_000;
/** What one file may contribute to the prompt. */
const PER_FILE_CHARS = 12_000;
/** The graph is built from at most this many files — scanWorkspace caps at 3000 already. */
const MAX_GRAPH_FILES = 1_500;
/** Mention search stays in the seeds' own neighbourhoods. */
const MAX_MENTION_FILES = 200;
export const DEFAULT_CONTEXT_CHARS = 60_000;
export const DEFAULT_CONTEXT_FILES = 12;
const DEFAULT_INDEX_LIMIT = 400;

export interface TaskContextRequest {
  /** The files the task names. They may not exist yet — the proposal often creates them. */
  seeds: string[];
  budgetChars?: number;
  maxFiles?: number;
  perFileChars?: number;
  /** Off by default: a second hop is what made the flattened graph noisier. */
  secondHop?: boolean;
  indexLimit?: number;
}

export interface TaskContextPlan {
  /** Ready-to-paste `### FILE:` blocks, in plan order. */
  blocks: string;
  entries: PlanEntry[];
  /** The path list the prompt carries: seeds and their edges first, then the rest. */
  indexPath: string[];
  /** True when the folder itself was cut short (3000 files) or the head pass hit its cap. */
  truncated: boolean;
  stats: { files: number; edges: number; packages: number };
}

function sameNeighbourhood(path: string, seeds: string[]): boolean {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  return seeds.some((seed) => {
    const seedDir = seed.includes('/') ? seed.slice(0, seed.lastIndexOf('/')) : '';
    return dir === seedDir || dir.startsWith(`${seedDir}/`) || seedDir.startsWith(`${dir}/`);
  });
}

/**
 * Plans what a task's prompt will carry.
 *
 * Throws only the errors `scanWorkspace` already throws (no folder connected) — an unreadable file
 * inside the folder is skipped, because one broken file must not cost the whole task.
 */
export function planTaskContext(request: TaskContextRequest): TaskContextPlan {
  const budgetChars = request.budgetChars ?? DEFAULT_CONTEXT_CHARS;
  const maxFiles = request.maxFiles ?? DEFAULT_CONTEXT_FILES;
  const perFileChars = request.perFileChars ?? PER_FILE_CHARS;
  // Every seed passes the same path guard a write does: a task cannot drag ".." into a prompt.
  const seeds: string[] = [];
  for (const raw of request.seeds || []) {
    if (typeof raw !== 'string' || !raw.trim()) continue;
    try {
      const relative = normalizeGraphPath(toRelativePath(resolveWorkspacePath(raw)));
      if (!seeds.includes(relative)) seeds.push(relative);
    } catch {
      /* a path outside the folder is not context; it is a refusal */
    }
  }

  const scan = scanWorkspace();
  const textFiles = scan.files.filter((file) => file.isText !== false);
  const heads: GraphFile[] = [];
  for (const file of textFiles.slice(0, MAX_GRAPH_FILES)) {
    try {
      const head = readWorkspaceTextFile(file.path, HEAD_BYTES).content;
      if (!head) continue;
      // `chars` is the body's own size, not the head's: the budget is spent on the whole file.
      heads.push({ path: file.path, text: head, chars: Math.max(head.length, file.sizeBytes || 0) });
    } catch {
      /* a file that disappeared (or a race with another writer) is simply not in the graph */
    }
  }

  const graph = buildGraph(heads, { isTest: (path) => inferFileType(path) === 'test' });

  const symbols = [...new Set(seeds.map(symbolFromPath).filter((s) => s.length >= 3))];
  const mentionCandidates = heads
    .filter((file) => sameNeighbourhood(file.path, seeds))
    .slice(0, MAX_MENTION_FILES);
  const mentions = findMentionPaths(mentionCandidates, symbols);

  const entries = planContext({
    seeds,
    graph,
    budgetChars,
    maxFiles,
    perFileChars,
    mentions,
    secondHop: request.secondHop === true
  });

  const blocks: string[] = [];
  for (const entry of entries) {
    if (entry.chars <= 0) continue; // a seed that does not exist yet is named, not shown
    let content = '';
    try {
      content = readWorkspaceTextFile(entry.path, entry.chars).content;
    } catch {
      continue;
    }
    if (!content) continue;
    blocks.push(`### FILE: ${entry.path}\n\`\`\`\n${content}\n\`\`\``);
  }

  const chosen = new Set(entries.map((entry) => entry.path));
  const priority = entries.filter((entry) => graph.nodes.has(entry.path)).map((entry) => entry.path);
  const rest = scan.files.map((file) => file.path).filter((path) => !chosen.has(path));
  const indexPath = [...priority, ...rest].slice(0, request.indexLimit ?? DEFAULT_INDEX_LIMIT);

  return {
    blocks: blocks.join('\n\n'),
    entries,
    indexPath,
    truncated: scan.truncated || textFiles.length > MAX_GRAPH_FILES,
    stats: {
      files: graph.nodes.size,
      edges: [...graph.nodes.values()].reduce((sum, node) => sum + node.imports.length, 0),
      packages: graph.packages.length
    }
  };
}

/** What the plan says, in one line — for a log or a counter, not for a paragraph in the UI. */
export function describePlan(plan: TaskContextPlan): string {
  const counts = new Map<string, number>();
  for (const entry of plan.entries) counts.set(entry.reason, (counts.get(entry.reason) || 0) + 1);
  const parts = ['seed', 'import', 'importer', 'test', 'mention']
    .filter((reason) => counts.has(reason))
    .map((reason) => `${reason}:${counts.get(reason)}`);
  return `${plan.entries.length} files (${parts.join(' ')})`;
}
