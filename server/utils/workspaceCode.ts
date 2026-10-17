import type { FileFacts, FileImplementation, FileInsights, ProjectFile, WorkspaceFacts } from '../../src/types';

/**
 * Reads what is already written inside the files of an existing project — with no AI involved.
 *
 * The project map could only list paths and sizes, so an imported project looked like an empty
 * plan even when it was half finished. This module looks at the real text of the files and says
 * what each one declares (classes, functions, signals), what it imports, and whether it is
 * implemented, a stub, or still empty. It is the honest baseline the AI layer is added on top of,
 * and it keeps working with no API key.
 */

export interface FactSourceFile {
  path: string;
  type?: ProjectFile['type'];
  sizeBytes?: number;
  /** Present only for files the app actually read: facts are made from real text. */
  content?: string;
}

interface SymbolRules {
  symbols: RegExp[];
  imports: RegExp[];
}

function normalizePath(filePath: string): string {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function baseName(filePath: string): string {
  return normalizePath(filePath).split('/').pop() || '';
}

function extensionOf(filePath: string): string {
  const name = baseName(filePath).toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1) : '';
}

function depthOf(filePath: string): number {
  return normalizePath(filePath).split('/').length - 1;
}

/** Files whose text can be read symbol by symbol. Everything else is left alone. */
const TS: SymbolRules = {
  // Plain `function main()` and `exports.save =` count too: a script is not empty for skipping the
  // `export` keyword, and half the Node projects in the world are written that way.
  symbols: [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm,
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\(|function|[A-Za-z_$][\w$]*\s*=>)/gm,
    /^\s*(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/gm,
    /^\s*(?:module\.)?exports\s*=\s*\{[\s\S]*?^\s{2,}([A-Za-z_$][\w$]*)\s*[,:]/gm
  ],
  imports: [
    /^\s*import\s+[^'"\n]*from\s*['"]([^'"]+)['"]/gm,
    /^\s*import\s*['"]([^'"]+)['"]/gm,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g
  ]
};

const CS: SymbolRules = {
  symbols: [
    /^\s*(?:\[[^\]]*\]\s*)?(?:public|internal|private|protected)?\s*(?:static\s+|sealed\s+|abstract\s+|partial\s+)*(?:class|struct|interface|enum|record)\s+([A-Za-z_]\w*)/gm,
    /^\s*(?:public|protected|private|internal)\s+(?:static\s+|virtual\s+|override\s+|async\s+|sealed\s+|readonly\s+|new\s+)*[\w<>\[\],\.\?]+\s+([A-Za-z_]\w*)\s*\(/gm
  ],
  imports: [/^\s*using\s+(?:static\s+)?([\w\.]+)\s*;/gm]
};

const GD: SymbolRules = {
  symbols: [
    /^\s*func\s+([A-Za-z_]\w*)/gm,
    /^\s*(?:class_name|signal)\s+([A-Za-z_]\w*)/gm,
    /^\s*@(?:export|onready)\s+(?:var\s+)?([A-Za-z_]\w*)/gm,
    /^\s*var\s+([A-Za-z_]\w*)/gm
  ],
  imports: [/preload\(\s*["']([^"']+)["']/g, /^\s*extends\s+([\w\.]+)/gm]
};

const PY: SymbolRules = {
  symbols: [/^\s*(?:async\s+)?def\s+(\w+)/gm, /^\s*class\s+(\w+)/gm],
  imports: [/^\s*from\s+([\w\.]+)\s+import/gm, /^\s*import\s+([\w\.]+)/gm]
};

const GO: SymbolRules = {
  symbols: [/^func\s+(?:\([^)]*\)\s*)?(\w+)/gm, /^type\s+(\w+)\s+(?:struct|interface)/gm],
  imports: [/^import\s+(?:\w+\s+)?"([^"]+)"/gm, /^\s+"([\w\.\/\-]+)"$/gm]
};

const RS: SymbolRules = {
  symbols: [/^\s*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/gm, /^\s*(?:pub\s+)?(?:struct|enum|trait|impl)\s+(\w+)/gm],
  imports: [/^\s*use\s+([\w:]+)/gm]
};

const LUA: SymbolRules = {
  symbols: [/^\s*(?:local\s+)?function\s+([\w\.:]+)/gm],
  imports: [/require\s*\(?\s*["']([^"']+)["']/g]
};

const RB: SymbolRules = {
  symbols: [/^\s*(?:def|class|module)\s+([\w:]+)/gm],
  imports: [/^\s*require(?:_relative)?\s*["']([^"']+)["']/gm]
};

const PHP: SymbolRules = {
  symbols: [/^\s*class\s+(\w+)/gm, /^\s*(?:public|private|protected|static)?\s*function\s+(\w+)/gm],
  imports: [/^\s*use\s+([\w\\]+)/gm]
};

const JVM: SymbolRules = {
  symbols: [
    /^\s*(?:public|private|protected)?\s*(?:static\s+|final\s+|abstract\s+|open\s+|data\s+)*(?:class|interface|enum|object)\s+(\w+)/gm,
    /^\s*(?:public|private|protected)\s+[\w<>\[\],\.\s]+\s+(\w+)\s*\(/gm
  ],
  imports: [/^\s*(?:import|using)\s+([\w\.]+)/gm]
};

const CPP: SymbolRules = {
  symbols: [
    /^\s*(?:class|struct|enum\s+class|enum)\s+(\w+)/gm,
    /^\s*[\w:<>~\[\]\*&]+\s+(\w+)\s*\([^;{]*\)\s*(?:const\s*)?\{/gm
  ],
  imports: [/^\s*#include\s*[<"]([^>"]+)[>"]/gm]
};

const GENERIC: SymbolRules = {
  symbols: [/^\s*(?:export\s+)?(?:function|def|func|fn|class|interface|struct|enum)\s+(\w+)/gm],
  imports: []
};

const RULES_BY_EXTENSION: Record<string, SymbolRules> = {
  ts: TS,
  tsx: TS,
  js: TS,
  jsx: TS,
  mjs: TS,
  cjs: TS,
  vue: TS,
  svelte: TS,
  cs: CS,
  gd: GD,
  py: PY,
  go: GO,
  rs: RS,
  lua: LUA,
  rb: RB,
  php: PHP,
  java: JVM,
  kt: JVM,
  kts: JVM,
  dart: JVM,
  swift: JVM,
  c: CPP,
  cc: CPP,
  cpp: CPP,
  cxx: CPP,
  h: CPP,
  hpp: CPP
};

/** Rule files and manifests are read for their text, not for their symbols. */
export function isAnalyzablePath(filePath: string): boolean {
  return Boolean(RULES_BY_EXTENSION[extensionOf(filePath)]);
}

/** How many names one file may contribute, so a single huge file cannot flood the map. */
const MAX_SYMBOLS = 12;
const MAX_IMPORTS = 8;

const TEST_PATH_RE = /(^|\/)(tests?|__tests__|spec|specs)\//i;
const TEST_NAME_RE = /(^|\/)[\w\.\-]*(_test|\.test|\.spec|_spec)\.[A-Za-z0-9]+$/i;
// A file called Player.ts is a class, not the way into the app, so only names that really boot
// something count here.
const ENTRY_RE =
  /(^|\/)(main|index|app|program|bootstrap|server|client|game|gamemanager|game_manager|startup)\.(ts|tsx|js|jsx|mjs|cjs|py|cs|gd|dart|go|rs|java|kt|c|cc|cpp|h|lua|rb|php)$/i;

export function isTestPath(filePath: string): boolean {
  const path = normalizePath(filePath);
  return TEST_PATH_RE.test(path) || TEST_NAME_RE.test(path);
}

export function isEntryPointPath(filePath: string): boolean {
  return ENTRY_RE.test(normalizePath(filePath));
}

/**
 * Not every entry point is equally the entry point: `src/main.tsx` boots the app, while `App.tsx`
 * is just the first component. The map shows the strongest one it can find.
 */
const ENTRY_RANK: Record<string, number> = {
  main: 0,
  index: 1,
  program: 2,
  startup: 3,
  bootstrap: 4,
  server: 5,
  client: 6,
  game: 7,
  gamemanager: 8,
  game_manager: 9,
  app: 10
};

function entryRank(filePath: string): number {
  const name = baseName(filePath).toLowerCase().split('.')[0];
  return ENTRY_RANK[name] ?? 20;
}

/**
 * Counts real code: comments and blank lines say nothing about whether a file is finished, so a
 * file with 300 blank lines is still empty.
 */
export function countCodeLines(text: string): { totalLines: number; codeLines: number } {
  const lines = String(text || '').split(/\r?\n/);
  let codeLines = 0;
  let inBlockComment = false;

  lines.forEach((rawLine) => {
    let line = rawLine.trim();
    if (!line) return;

    if (inBlockComment) {
      const end = line.indexOf('*/');
      if (end === -1) return;
      inBlockComment = false;
      line = line.slice(end + 2).trim();
      if (!line) return;
    }

    while (line.startsWith('/*')) {
      const end = line.indexOf('*/', 2);
      if (end === -1) {
        inBlockComment = true;
        return;
      }
      line = line.slice(end + 2).trim();
    }
    if (!line) return;

    // A leading `#` only means a comment when it is not a preprocessor directive.
    if (/^(\/\/|--|\*|#(?!(?:include|define|if|ifdef|ifndef|else|elif|endif|pragma|region|endregion)\b))/.test(line)) return;
    codeLines += 1;
  });

  return { totalLines: lines.length, codeLines };
}

/** Names in the order they are written, so the map reads like the file does. */
function collectNames(text: string, patterns: RegExp[], limit: number): string[] {
  const found: { name: string; index: number }[] = [];

  patterns.forEach((pattern) => {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const regex = new RegExp(pattern.source, flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const name = (match[1] || '').trim();
      if (name && !found.some((entry) => entry.name === name)) {
        found.push({ name, index: match.index });
      }
      if (match.index === regex.lastIndex) regex.lastIndex += 1;
    }
  });

  return found
    .sort((a, b) => a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.name);
}

/** Markers that prove the code is still waiting to be written. */
const STUB_MARKERS: RegExp[] = [
  /not\s+implemented/i,
  /NotImplementedError/,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bstub\b/i,
  /\bplaceholder\b/i,
  /throw new Error\(\s*['"`](?:not|todo)/i,
  /^\s*pass\s*$/m,
  /implement later/i,
  /реализовать\s+позже/i,
  /заглушка/i
];

/**
 * Implemented, a stub, or still empty — decided from the text itself. Entry points are never
 * called stubs for having few declarations: a boot file is made of calls, not of classes.
 */
export function judgeImplementation(
  text: string,
  codeLines: number,
  symbolCount: number,
  options: { isEntryPoint?: boolean } = {}
): FileImplementation {
  if (codeLines === 0) return 'empty';

  const marked = STUB_MARKERS.some((marker) => marker.test(text));
  const looksWritten = symbolCount >= 2 || codeLines >= 30 || options.isEntryPoint === true;

  if (marked) return looksWritten ? 'partial' : 'stub';
  if (symbolCount === 0) return codeLines < 8 && !options.isEntryPoint ? 'stub' : 'partial';
  if (symbolCount === 1 && codeLines < 30) return 'partial';
  return 'implemented';
}

/** What one file of the project already contains. Null for files that are not source code. */
export function analyzeSourceFile(filePath: string, text: string): FileFacts | null {
  const rules = RULES_BY_EXTENSION[extensionOf(filePath)];
  if (!rules) return null;

  const content = String(text || '');
  const { totalLines, codeLines } = countCodeLines(content);
  const symbols = collectNames(content, rules.symbols, MAX_SYMBOLS);
  const imports = collectNames(content, rules.imports, MAX_IMPORTS);

  return {
    path: normalizePath(filePath),
    symbols,
    imports,
    codeLines,
    totalLines,
    status: judgeImplementation(content, codeLines, symbols.length, { isEntryPoint: isEntryPointPath(filePath) }),
    isEntryPoint: isEntryPointPath(filePath),
    isTest: isTestPath(filePath)
  };
}

/**
 * The picture of a whole folder: what each readable file declares, and the architecture the files
 * prove — the entry point, how many scripts carry real declarations, and whether tests exist.
 */
export function buildWorkspaceFacts(files: FactSourceFile[]): WorkspaceFacts {
  const analyzed: FileFacts[] = [];

  files.forEach((file) => {
    if (typeof file.content !== 'string') return;
    const facts = analyzeSourceFile(file.path, file.content);
    if (facts) analyzed.push(facts);
  });

  analyzed.sort((a, b) => a.path.localeCompare(b.path));

  const entry = analyzed
    .filter((file) => file.isEntryPoint)
    .sort(
      (a, b) =>
        entryRank(a.path) - entryRank(b.path) ||
        depthOf(a.path) - depthOf(b.path) ||
        a.path.localeCompare(b.path)
    )[0];

  const countOf = (status: FileImplementation) => analyzed.filter((file) => file.status === status).length;

  return {
    files: analyzed,
    analyzedFiles: analyzed.length,
    scannedFiles: files.length,
    detectedArchitecture: {
      mainEntry: entry?.path || analyzed[0]?.path || '',
      componentsOrScriptsCount: analyzed.filter((file) => file.symbols.length > 0).length,
      hasTests: files.some((file) => isTestPath(file.path)),
      implementedFiles: countOf('implemented'),
      stubFiles: countOf('stub'),
      emptyFiles: countOf('empty')
    }
  };
}

/**
 * Which files are worth reading. Reading the whole repository would be slow on a big project, so
 * the shallowest source files come first and huge generated ones are skipped by size.
 */
export function pickFactCandidates(
  files: FactSourceFile[],
  options: { maxFiles?: number; maxBytes?: number } = {}
): string[] {
  const maxFiles = options.maxFiles ?? 60;
  const maxBytes = options.maxBytes ?? 120_000;

  return files
    .filter((file) => isAnalyzablePath(file.path))
    .filter((file) => typeof file.sizeBytes !== 'number' || file.sizeBytes <= maxBytes)
    .sort((a, b) => depthOf(a.path) - depthOf(b.path) || a.path.localeCompare(b.path))
    .slice(0, maxFiles)
    .map((file) => file.path);
}

const STATUS_LABEL: Record<FileImplementation, { ru: string; en: string }> = {
  implemented: { ru: 'реализовано', en: 'implemented' },
  partial: { ru: 'частично', en: 'partial' },
  stub: { ru: 'заготовка', en: 'stub' },
  empty: { ru: 'пусто', en: 'empty' }
};

export function statusLabel(status: FileImplementation, isRu: boolean): string {
  return isRu ? STATUS_LABEL[status].ru : STATUS_LABEL[status].en;
}

/**
 * The offline reading of the same facts: no key, no AI call, but the user still learns what is
 * already there and what to do next.
 */
export function buildLocalInsights(facts: WorkspaceFacts, isRu: boolean): FileInsights {
  const arch = facts.detectedArchitecture;
  const interesting = facts.files.filter((file) => file.status !== 'empty');

  const overall = isRu
    ? `Прочитано файлов: ${facts.analyzedFiles} из ${facts.scannedFiles}. Реализовано: ${arch.implementedFiles}, частично: ${
        facts.files.filter((file) => file.status === 'partial').length
      }, заготовок: ${arch.stubFiles}, пусто: ${arch.emptyFiles}. Точка входа: ${arch.mainEntry || 'не найдена'}.`
    : `Read ${facts.analyzedFiles} of ${facts.scannedFiles} files. Implemented: ${arch.implementedFiles}, partial: ${
        facts.files.filter((file) => file.status === 'partial').length
      }, stubs: ${arch.stubFiles}, empty: ${arch.emptyFiles}. Entry point: ${arch.mainEntry || 'not found'}.`;

  const files = interesting
    .slice()
    .sort((a, b) => b.codeLines - a.codeLines || a.path.localeCompare(b.path))
    .slice(0, 12)
    .map((file) => ({
      path: file.path,
      status: file.status,
      implemented: [
        isRu
          ? `${statusLabel(file.status, true)}: ${file.codeLines} строк кода`
          : `${statusLabel(file.status, false)}: ${file.codeLines} lines of code`,
        file.symbols.length > 0
          ? `${isRu ? 'Объявления' : 'Declarations'}: ${file.symbols.slice(0, 6).join(', ')}`
          : isRu
          ? 'Объявлений не найдено'
          : 'No declarations found'
      ]
    }));

  const nextSteps: string[] = [];
  const unfinished = facts.files.filter((file) => file.status === 'stub').map((file) => file.path);
  if (unfinished.length > 0) {
    nextSteps.push(
      isRu
        ? `Дописать заготовки: ${unfinished.slice(0, 4).join(', ')}`
        : `Finish the stubs: ${unfinished.slice(0, 4).join(', ')}`
    );
  }
  if (!arch.hasTests) {
    nextSteps.push(isRu ? 'В проекте нет тестов — добавьте первые на самый важный модуль.' : 'There are no tests yet — add the first ones around the most important module.');
  }
  if (arch.mainEntry) {
    nextSteps.push(isRu ? `Начать с точки входа ${arch.mainEntry}.` : `Start from the entry point ${arch.mainEntry}.`);
  }

  return { generatedAt: new Date().toISOString(), overall, files, nextSteps };
}
