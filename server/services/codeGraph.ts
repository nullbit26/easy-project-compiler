/**
 * The import graph, as pure functions.
 *
 * The prompt an agent gets used to be "the eight files the plan named". If the plan forgot the
 * type file the API returns, the model never saw it — and the fix for that is not an embedding
 * database, it is the imports the code already writes down. This module reads them, resolves the
 * relative ones inside the folder, and orders what deserves the prompt's budget:
 *
 *   1. `seed`     — the files the task names;
 *   2. `import`   — what a seed imports (types, clients, config);
 *   3. `importer` — what imports a seed (what breaks when its signature changes);
 *   4. `test`     — the tests that import a seed;
 *   5. `mention`  — files that name the seed's symbol without importing it.
 *
 * One hop by default, a second only when the character budget is still open — the research is
 * blunt that a two-hop closure on its own got worse, not better. Nothing here touches the disk,
 * nothing here embeds anything, and every order is deterministic: same input, same plan.
 */

export type ImportKind = 'relative' | 'python' | 'package' | 'root' | 'bare';

export interface ImportRef {
  /** The specifier as the source wrote it, without quotes. */
  specifier: string;
  kind: ImportKind;
}

export interface GraphFile {
  /** Workspace-relative, forward slashes. */
  path: string;
  /** The text that was read — the whole file when small, its head when it is not. */
  text: string;
  /** What the file weighs when the whole thing is sent. Defaults to `text.length`. */
  chars?: number;
}

export interface GraphNode {
  path: string;
  /** Characters this file costs in the prompt (an upper bound when only its head was read). */
  chars: number;
  /** Resolved paths inside the folder. */
  imports: string[];
  /** Specifiers that point outside the folder (npm, the standard library, aliases). */
  external: string[];
  isTest: boolean;
}

export interface CodeGraph {
  nodes: Map<string, GraphNode>;
  /** path -> the files inside the folder that import it. */
  importers: Map<string, string[]>;
  /** Every specifier the folder could not resolve to a file, sorted. */
  packages: string[];
}

export type ContextReason = 'seed' | 'import' | 'importer' | 'test' | 'mention';

export interface PlanEntry {
  path: string;
  reason: ContextReason;
  /** 1 for the seed's own edges, 2 for the second hop. */
  hop: 1 | 2;
  /** What this file is estimated to cost. */
  chars: number;
}

export interface PlanOptions {
  seeds: string[];
  graph: CodeGraph;
  /** Total characters the prompt may spend on file bodies. */
  budgetChars: number;
  /** Hard cap on files, whatever the budget says. */
  maxFiles: number;
  /** Per-file crop, so one giant file cannot eat the budget. Defaults to 12 000. */
  perFileChars?: number;
  /** Files found by `findMentionPaths`; they only enter when the budget is still open. */
  mentions?: string[];
  /** The second hop is opt-in: it is what made the flattened graph noisier. */
  secondHop?: boolean;
}

/** Extensions a relative import may omit, in the order TypeScript/Node would try them. */
const RESOLVE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.vue',
  '.svelte',
  '.py',
  '.cs',
  '.gd',
  '.java',
  '.kt',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.dart',
  '.lua',
  '.swift',
  '.h',
  '.hpp',
  '.c',
  '.cpp',
  '.m',
  '.css',
  '.scss',
  '.json'
];

/** `./x.js` in ESM TypeScript actually means `./x.ts`: try both before giving up. */
const JS_TO_TS: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx', '.ts'],
  '.mjs': ['.mts', '.ts'],
  '.cjs': ['.cts', '.ts']
};

export function normalizeGraphPath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function dirOf(value: string): string {
  const normalized = normalizeGraphPath(value);
  const cut = normalized.lastIndexOf('/');
  return cut === -1 ? '' : normalized.slice(0, cut);
}

function joinPath(base: string, rest: string): string {
  const parts = `${base ? `${base}/` : ''}${rest}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

function pythonBase(from: string, specifier: string): string | null {
  const dots = specifier.match(/^\.+/)?.[0].length || 0;
  let base = dirOf(from);
  for (let up = 1; up < dots; up += 1) {
    if (!base) return null;
    base = dirOf(base);
  }
  const rest = specifier.slice(dots).replace(/\./g, '/');
  return joinPath(base, rest);
}

/**
 * Every import the source states, grouped by syntax and without duplicates.
 *
 * Deliberately a scanner, not a parser: it runs on a file head, it never fails on syntax it does
 * not know, and a missed edge costs one file of context rather than the whole plan.
 */
export function parseImports(text: string): ImportRef[] {
  const found: ImportRef[] = [];
  const seen = new Set<string>();
  const add = (specifier: string | undefined, kind: ImportKind) => {
    const spec = (specifier || '').trim();
    if (!spec) return;
    const key = `${kind}:${spec}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ specifier: spec, kind });
  };

  const kindOf = (spec: string): ImportKind => {
    if (spec.startsWith('.')) return 'relative';
    if (/^[a-z]+:\/\//i.test(spec)) return spec.toLowerCase().startsWith('res://') ? 'root' : 'bare';
    if (spec.startsWith('/')) return 'root';
    if (spec.startsWith('@/') || spec.startsWith('~/')) return 'bare';
    return 'bare';
  };

  // import x from './y', import type { A } from "./y", export * from './y'
  for (const match of text.matchAll(
    /(?:^|\n)[ \t]*(?:import|export)\s+(?:type\s+)?[^'"\n;]*?\bfrom\s*['"]([^'"\n]+)['"]/g
  )) {
    add(match[1], kindOf(match[1]));
  }
  // import './styles.css'
  for (const match of text.matchAll(/(?:^|\n)[ \t]*import\s*['"]([^'"\n]+)['"]/g)) {
    add(match[1], kindOf(match[1]));
  }
  // require('./x'), import('./x'), preload("res://x.gd")
  for (const match of text.matchAll(/\b(?:require|import|preload|load)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)) {
    const spec = match[1];
    add(spec, spec.startsWith('res://') ? 'root' : kindOf(spec));
  }
  // #include "x.h"
  for (const match of text.matchAll(/#\s*include\s*[<"]([^">\n]+)[">]/g)) {
    add(match[1], kindOf(match[1]));
  }
  // from .models import Player, from app.config import settings
  for (const match of text.matchAll(/^[ \t]*from[ \t]+([.\w]+)[ \t]+import\b/gm)) {
    const spec = match[1];
    add(spec, spec.startsWith('.') ? 'python' : 'package');
  }
  // import os, import app.models
  for (const match of text.matchAll(/^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm)) {
    for (const part of match[1].split(',')) {
      const spec = part.trim();
      if (spec) add(spec, spec.includes('.') ? 'package' : 'bare');
    }
  }
  // using MyGame.Core;  (C# namespaces map to folders often enough to try)
  for (const match of text.matchAll(/^[ \t]*using[ \t]+(?:static[ \t]+)?([\w.]+)[ \t]*;/gm)) {
    add(match[1], 'package');
  }

  return found;
}

/**
 * The file a specifier points at, or null when it points outside the folder.
 *
 * Only relative and project-relative specifiers are resolved: a bare `react` is an external
 * package, and pretending otherwise would put `node_modules` into the prompt. Specifier paths
 * never escape the folder — `joinPath` folds `..`, and a folded path outside the file set simply
 * does not match.
 */
export function resolveImport(from: string, ref: ImportRef, fileSet: Set<string>): string | null {
  const specifier = ref.specifier.trim();
  if (!specifier || ref.kind === 'bare') return null;

  let base: string | null = null;
  if (ref.kind === 'relative') {
    base = joinPath(dirOf(from), specifier);
  } else if (ref.kind === 'root') {
    base = joinPath('', specifier.replace(/^res:\/\//i, '').replace(/^\/+/, ''));
  } else if (ref.kind === 'python') {
    base = pythonBase(from, specifier);
  } else {
    // A namespace (`MyGame.Core`, `app.config`) is a path only if such a file exists.
    base = joinPath('', specifier.replace(/\./g, '/'));
  }
  if (!base) return null;

  const candidates: string[] = [];
  const extension = `.${base.split('/').pop()?.split('.').slice(1).join('.') || ''}`;
  const hasKnownExtension = base.includes('.') && RESOLVE_EXTENSIONS.includes(extension);

  if (hasKnownExtension) {
    candidates.push(base);
    for (const swap of JS_TO_TS[extension] || []) {
      candidates.push(`${base.slice(0, -extension.length)}${swap}`);
    }
  } else {
    for (const ext of RESOLVE_EXTENSIONS) candidates.push(`${base}${ext}`);
    for (const ext of RESOLVE_EXTENSIONS) candidates.push(`${base}/index${ext}`);
    candidates.push(`${base}/__init__.py`);
  }
  for (const candidate of candidates) {
    const normalized = normalizeGraphPath(candidate);
    if (fileSet.has(normalized)) return normalized;
  }
  return null;
}

export function buildGraph(
  files: GraphFile[],
  options: { isTest?: (path: string) => boolean } = {}
): CodeGraph {
  const fileSet = new Set(files.map((file) => normalizeGraphPath(file.path)));
  const nodes = new Map<string, GraphNode>();
  const importers = new Map<string, string[]>();
  const packages = new Set<string>();

  for (const file of files) {
    const path = normalizeGraphPath(file.path);
    const imports: string[] = [];
    const external: string[] = [];
    for (const ref of parseImports(file.text)) {
      const resolved = resolveImport(path, ref, fileSet);
      if (resolved && resolved !== path) {
        if (!imports.includes(resolved)) imports.push(resolved);
        continue;
      }
      external.push(ref.specifier);
      packages.add(ref.specifier);
    }
    nodes.set(path, {
      path,
      chars: file.chars ?? file.text.length,
      imports,
      external,
      isTest: options.isTest ? options.isTest(path) : /(^|\/)[^/]+\.(test|spec)\.[a-z0-9]+$/i.test(path)
    });
  }

  for (const node of nodes.values()) {
    for (const target of node.imports) {
      const list = importers.get(target) || [];
      list.push(node.path);
      importers.set(target, list);
    }
  }
  for (const list of importers.values()) list.sort((a, b) => a.localeCompare(b));

  return { nodes, importers, packages: [...packages].sort((a, b) => a.localeCompare(b)) };
}

/**
 * Files that name a symbol without importing it.
 *
 * This is the cheap half of "references": a class used through a singleton, a name in a scene,
 * a string in a config. It runs over text already read, so it costs a regex, not a second scan.
 */
export function findMentionPaths(files: GraphFile[], symbols: string[]): string[] {
  const wanted = symbols.map((s) => s.trim()).filter((s) => s.length >= 3);
  if (wanted.length === 0) return [];
  const pattern = new RegExp(
    `(^|[^A-Za-z0-9_$])(${wanted.map(escapeRegExp).join('|')})([^A-Za-z0-9_$]|$)`
  );
  const hits: string[] = [];
  for (const file of files) {
    if (pattern.test(file.text)) hits.push(normalizeGraphPath(file.path));
  }
  return [...new Set(hits)].sort((a, b) => a.localeCompare(b));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The symbol a file is probably known by: `PlayerHealth.cs` -> `PlayerHealth`. */
export function symbolFromPath(value: string): string {
  const name = normalizeGraphPath(value).split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * The ordered, budgeted list of files the prompt will carry.
 *
 * Seeds are kept in the order the task states them, every other group is alphabetical, and the
 * first reason a path earns is the one it keeps. A seed that does not exist yet still appears —
 * the proposal is likely to create it — at zero cost.
 */
export function planContext(options: PlanOptions): PlanEntry[] {
  const { graph, budgetChars, maxFiles } = options;
  const perFileChars = options.perFileChars ?? 12_000;
  const entries: PlanEntry[] = [];
  const chosen = new Set<string>();
  let remaining = budgetChars;

  const take = (path: string, reason: ContextReason, hop: 1 | 2): boolean => {
    if (entries.length >= maxFiles) return false;
    const normalized = normalizeGraphPath(path);
    if (chosen.has(normalized)) return false;
    const node = graph.nodes.get(normalized);
    const chars = node ? Math.min(node.chars, perFileChars) : 0;
    // A seed is the task itself: it is never dropped for want of budget. Everything the graph
    // brings in has to fit, which is the whole point of ordering by reason.
    if (node && chars > remaining && reason !== 'seed') return false;
    chosen.add(normalized);
    entries.push({ path: normalized, reason, hop, chars });
    remaining -= chars;
    return true;
  };

  const seeds = options.seeds.map(normalizeGraphPath).filter(Boolean);
  for (const seed of seeds) take(seed, 'seed', 1);

  const edgesOf = (paths: string[], kind: 'imports' | 'importers'): string[] => {
    const out: string[] = [];
    for (const p of paths) {
      const node = graph.nodes.get(normalizeGraphPath(p));
      if (!node) continue;
      const list = kind === 'imports' ? node.imports : graph.importers.get(node.path) || [];
      for (const item of list) if (!out.includes(item)) out.push(item);
    }
    return out.sort((a, b) => a.localeCompare(b));
  };

  const level1 = seeds.filter((seed) => graph.nodes.has(seed));
  for (const path of edgesOf(level1, 'imports')) take(path, 'import', 1);

  const importers = edgesOf(level1, 'importers');
  for (const path of importers.filter((p) => !graph.nodes.get(p)?.isTest)) take(path, 'importer', 1);
  for (const path of importers.filter((p) => graph.nodes.get(p)?.isTest)) take(path, 'test', 1);

  for (const path of options.mentions || []) take(path, 'mention', 1);

  if (options.secondHop) {
    const firstHop = entries.filter((entry) => entry.reason === 'import').map((entry) => entry.path);
    for (const path of edgesOf(firstHop, 'imports')) take(path, 'import', 2);
  }

  return entries;
}
