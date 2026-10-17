import { withCursorFrontmatter, type RuleFileToWrite } from './rulesFiles';

/**
 * A rules file is the one document in a project nobody re-reads. It is written once, then the
 * project moves on: the file it names gets renamed, the script it calls gets deleted, the same
 * sentence appears twice with a slightly different verb. An agent reading it has no way to know,
 * so it follows an instruction that no longer describes the repository.
 *
 * Everything checked here is deterministic — a comparison against the real folder, not a model's
 * opinion — because a checker that invents findings is worse than no checker at all. Every finding
 * carries the line it came from, so the reader can disagree with it and see why it fired.
 *
 * What is deliberately *not* here: style, tone, wording, and anything that needs judgement about
 * meaning. Two sentences that contradict each other in spirit but share no subject are not detected,
 * and the module says so by staying quiet rather than guessing.
 */

export type RuleFindingKind =
  | 'duplicate-line'
  | 'duplicate-across-files'
  | 'contradiction'
  | 'missing-file'
  | 'missing-command'
  | 'missing-frontmatter'
  | 'inactive-frontmatter'
  | 'empty-document';

/** `problem` is something to fix before the file goes anywhere; `note` is worth knowing. */
export type RuleSeverity = 'problem' | 'note';

export interface RuleFinding {
  id: string;
  kind: RuleFindingKind;
  severity: RuleSeverity;
  /** The rule file the finding came from. */
  file: string;
  line?: number;
  /** Extra lines the finding is about (a duplicate's other occurrences). */
  againstLines?: number[];
  /** The text that triggered it, so the reading is the reader's to judge. */
  evidence: string;
  /** A contradiction's other half. */
  against?: string;
  /** The path or script name that is missing from the folder. */
  missing?: string;
  /** Which flavour of a missing command it is. */
  context?: 'no-package-json' | 'not-declared';
}

export interface RuleAuditInput {
  /** The exact documents that would be written. */
  documents: RuleFileToWrite[];
  /**
   * Project-relative paths in the connected folder, or null when nothing is connected. A null here
   * means "there is no folder to look at at all": the same rules cannot be judged against it, so
   * nothing that needs the folder — file references and commands alike — is reported.
   */
  workspacePaths: string[] | null;
  /** Script names from the folder's package.json, or null when the folder has none. */
  packageScripts: string[] | null;
}

export interface RuleAuditResult {
  findings: RuleFinding[];
  problems: number;
  notes: number;
  /** What could actually be checked, so the screen can say it instead of implying more. */
  compared: { files: boolean; commands: boolean };
}

/** Documents are a few kilobytes; this only bounds pathological ones. */
const MAX_LINES_PER_DOCUMENT = 400;
/** Shorter lines repeat by accident ("- Tests"), long ones repeat by copy-paste. */
const MIN_DUPLICATE_LENGTH = 20;

const KNOWN_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'md', 'mdc', 'cs', 'gd', 'tscn', 'tres', 'unity',
  'prefab', 'asset', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'dart', 'html', 'htm', 'css',
  'scss', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'sh', 'ps1', 'bat', 'txt', 'xml', 'svg', 'env'
];

/**
 * `\b` in JavaScript only knows ASCII word characters, so `\bникогда\b` never matches anything:
 * every Russian rule file — which is most of them here — read as if it had no negations at all, and
 * the contradiction check quietly found nothing. These guards use Unicode letter/digit lookarounds
 * instead, so a word is matched whole in any script.
 *
 * A space in the phrase stands for any run of whitespace ("do not" / "do   not").
 */
function wordPattern(phrase: string, options: { stem?: boolean } = {}): RegExp {
  const escaped = phrase.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const head = '(?<![\\p{L}\\p{N}_])';
  const tail = options.stem ? '' : '(?![\\p{L}\\p{N}_])';
  return new RegExp(`${head}${escaped}${tail}`, 'giu');
}

const NEGATIONS = [
  'do not', "don't", 'don’t', 'does not', 'never', 'avoid', 'must not', 'should not', 'not use',
  'не', 'никогда', 'нельзя', 'избегай', 'не стоит', 'запрещ'
].map((phrase) => wordPattern(phrase, { stem: phrase.endsWith('запрещ') }));

/** Verbs dropped before comparing subjects, so "Use X" and "Do not use X" meet on X. */
const VERBS = [
  'использовать', 'применять', 'вызывать', 'делать', 'писать', 'используйте', 'используй',
  'use', 'using', 'write', 'call', 'add'
].map((verb) => wordPattern(verb));

const STOPWORDS = new Set([
  'в', 'во', 'и', 'на', 'с', 'со', 'по', 'для', 'из', 'к', 'ко', 'о', 'об', 'при', 'у', 'за', 'от',
  'до', 'не', 'это', 'все', 'весь', 'вся', 'всегда', 'только', 'вместо', 'как',
  'the', 'a', 'an', 'to', 'of', 'for', 'in', 'on', 'with', 'and', 'or', 'this', 'that', 'all',
  'always', 'only', 'instead', 'as', 'it', 'its', 'be', 'is', 'are'
]);

/** npm's own subcommands, which are not scripts declared in package.json. */
const NPM_BUILTINS = new Set([
  'install', 'i', 'ci', 'init', 'exec', 'create', 'publish', 'update', 'audit', 'outdated', 'ls',
  'link', 'dedupe', 'cache', 'config', 'version', 'help', 'why', 'doctor', 'fund', 'pack', 'uninstall',
  'remove', 'add', 'dlx'
]);

interface DocLine {
  number: number;
  text: string;
}

function linesOf(content: string): DocLine[] {
  return content
    .split(/\r?\n/)
    .slice(0, MAX_LINES_PER_DOCUMENT)
    .map((text, index) => ({ number: index + 1, text }));
}

function isInstruction(line: string): boolean {
  const trimmed = line.trim();
  // Headings and frontmatter fences are structure, not instructions.
  return trimmed.length > 0 && !/^#{1,6}\s/.test(trimmed) && !/^---\s*$/.test(trimmed) && !/^\w+:\s/.test(trimmed);
}

function normalizeLine(text: string): string {
  return text
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/[`*_#>]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;:,]+$/, '')
    .trim()
    .toLowerCase();
}

function hasNegation(text: string): boolean {
  // A pattern that matched once stays "lastIndex"-advanced; reset before every test.
  return NEGATIONS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

/** The comparable subject of an instruction: polarity words and verbs removed, order ignored. */
function subjectKey(text: string): string {
  let subject = ` ${text.toLowerCase()} `;
  for (const pattern of NEGATIONS) subject = subject.replace(pattern, ' ');
  for (const verb of VERBS) subject = subject.replace(verb, ' ');
  return subject
    .replace(/[^\p{L}\p{N}_\s.@/-]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
    .sort()
    .join(' ');
}

/* ------------------------------------------------------------------ *
 * References: what the rules point at, and whether it is still there.
 * ------------------------------------------------------------------ */

/**
 * A token as written in prose carries its punctuation with it: `<src/App.tsx>` is a placeholder
 * whose inner path is still a path the rule talks about, and `src/main.js,` ends in a comma. Only
 * the wrapping is removed — a trailing slash is kept, because it is what marks a directory.
 */
function cleanToken(token: string): string {
  return token.replace(/^[<(\"']+/, '').replace(/[>)\",';:]+$/, '');
}

function looksLikePath(token: string): boolean {
  const candidate = cleanToken(token);
  if (candidate.length < 4) return false;
  if (/^(?:https?:|www\.|mailto:)/i.test(candidate)) return false;
  if (/^[a-z]:[\\/]/i.test(candidate)) return false;
  if (/[*?<>{}[\]|]/.test(candidate)) return false;
  if (/(?:^|[/\\])node_modules(?:[/\\]|$)/.test(candidate)) return false;
  if (candidate.startsWith('@') || /^\.{2,}/.test(candidate)) return false;
  if (/\s/.test(candidate)) return false;

  const hasSeparator = /[/\\]/.test(candidate);
  const extension = candidate.split('.').pop()?.toLowerCase() || '';
  return hasSeparator || KNOWN_EXTENSIONS.includes(extension);
}

/** Paths a line talks about: backticked spans first, then bare tokens that read like a path. */
export function referencedPaths(line: string): string[] {
  const found = new Set<string>();
  const cleaned = line.replace(/`([^`\n]+)`/g, (_match, span: string) => {
    for (const token of String(span).split(/\s+/)) {
      const candidate = cleanToken(token);
      if (looksLikePath(candidate)) found.add(candidate);
    }
    // The span is left out of the bare scan so its parts are not counted twice.
    return ' ';
  });

  for (const token of cleaned.split(/\s+/)) {
    const bare = cleanToken(token);
    if (looksLikePath(bare)) found.add(bare);
  }

  // Only punctuation goes; a trailing slash is the difference between the folder `src/` and a file `src`.
  return [...found].map((token) => token.replace(/\\/g, '/').replace(/[,;:]+$/, '').trim()).filter(Boolean);
}

/** npm/yarn/pnpm script references, which only work if package.json declares them. */
export function referencedScripts(line: string): string[] {
  const names = new Set<string>();
  const pattern = /\b(?:npm|yarn|pnpm)\s+(?:run\s+)?([\w:.-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line))) {
    const name = match[1];
    if (!name) continue;
    const bare = name.toLowerCase();
    if (NPM_BUILTINS.has(bare)) continue;
    if (bare === 'run') continue;
    names.add(name);
  }
  return [...names];
}

/**
 * The scripts a folder's package.json declares, or null when there is no usable manifest. The
 * checker needs it, the server needs it for the compiled prompt, and the rules panel needs it to
 * show the rules against the folder — one reading, so the three can never disagree.
 */
export function scriptsFromManifest(content: string): string[] | null {
  try {
    const parsed = JSON.parse(content);
    const scripts = parsed?.scripts;
    if (!scripts || typeof scripts !== 'object') return [];
    return Object.keys(scripts).filter((name) => typeof scripts[name] === 'string');
  } catch {
    return null;
  }
}

function pathIsThere(token: string, paths: string[], basenames: Set<string>): boolean {
  const normalized = token.toLowerCase();
  if (normalized.endsWith('/')) {
    return paths.some((path) => path.startsWith(normalized));
  }
  if (paths.includes(normalized)) return true;
  // A file may live in a directory the scan skips; a matching name anywhere is enough evidence
  // that the rule is not stale. A missing name is what we report.
  const base = normalized.split('/').pop() || '';
  return base.length > 3 && basenames.has(base);
}

/* ------------------------------------------------------------------ *
 * The audit itself.
 * ------------------------------------------------------------------ */

function frontmatterOf(content: string): string | null {
  if (!content.startsWith('---')) return null;
  const end = content.indexOf('\n---', 3);
  return end === -1 ? null : content.slice(0, end);
}

export function auditRules(input: RuleAuditInput): RuleAuditResult {
  const findings: RuleFinding[] = [];
  // Nothing connected means nothing to compare with. A folder that is not there is not a folder
  // "with no package.json": saying so would put a finding on the screen that is simply untrue.
  const connected = Array.isArray(input.workspacePaths);
  const compared = {
    files: connected,
    commands: connected
  };

  const paths = compared.files ? (input.workspacePaths || []).map((path) => path.replace(/\\/g, '/').toLowerCase()) : [];
  const basenames = new Set(paths.map((path) => path.split('/').pop() || ''));
  const scripts = input.packageScripts ? input.packageScripts.map((name) => name.toLowerCase()) : null;

  /** Normalized instruction -> where it was seen, for the duplicate check. */
  const seen = new Map<string, { file: string; line: number; evidence: string }[]>();

  for (const document of input.documents) {
    const lines = linesOf(document.content);
    const instructions = lines.filter((line) => isInstruction(line.text));

    if (instructions.length === 0) {
      findings.push({
        id: `${document.path}:empty`,
        kind: 'empty-document',
        severity: 'problem',
        file: document.path,
        evidence: document.content.trim().slice(0, 120),
      });
    }

    const subjects = new Map<string, { line: number; text: string; negative: boolean }[]>();

    for (const line of instructions) {
      const normalized = normalizeLine(line.text);
      if (normalized.length >= MIN_DUPLICATE_LENGTH) {
        const bucket = seen.get(normalized) || [];
        bucket.push({ file: document.path, line: line.number, evidence: line.text.trim() });
        seen.set(normalized, bucket);
      }

      // No "does this line look like it holds a path" gate: that test is false for every ordinary
      // sentence (it rejects anything containing a space), so the whole scan used to be skipped.
      // `referencedPaths` already decides token by token what counts as a path.
      for (const token of compared.files ? referencedPaths(line.text) : []) {
        if (!pathIsThere(token, paths, basenames)) {
          findings.push({
            id: `${document.path}:${line.number}:missing-file:${token}`,
            kind: 'missing-file',
            severity: 'problem',
            file: document.path,
            line: line.number,
            evidence: line.text.trim(),
            missing: token
          });
        }
      }

      for (const script of connected ? referencedScripts(line.text) : []) {
        const declared = scripts !== null && scripts.includes(script.toLowerCase());
        if (declared) continue;
        findings.push({
          id: `${document.path}:${line.number}:missing-command:${script}`,
          kind: 'missing-command',
          severity: 'problem',
          file: document.path,
          line: line.number,
          evidence: line.text.trim(),
          missing: `npm run ${script}`,
          context: scripts === null ? 'no-package-json' : 'not-declared'
        });
      }

      const subject = subjectKey(line.text);
      if (subject.length >= 3) {
        const bucket = subjects.get(subject) || [];
        bucket.push({ line: line.number, text: line.text.trim(), negative: hasNegation(line.text) });
        subjects.set(subject, bucket);
      }
    }

    for (const [subject, entries] of subjects) {
      const negative = entries.find((entry) => entry.negative);
      const positive = entries.find((entry) => !entry.negative);
      if (!negative || !positive) continue;
      findings.push({
        id: `${document.path}:contradiction:${subject}`,
        kind: 'contradiction',
        severity: 'problem',
        file: document.path,
        line: negative.line,
        evidence: negative.text,
        against: positive.text
      });
    }

    if (document.key === 'cursor') {
      const frontmatter = frontmatterOf(document.content);
      if (!frontmatter) {
        findings.push({
          id: `${document.path}:frontmatter`,
          kind: 'missing-frontmatter',
          severity: 'problem',
          file: document.path,
          evidence: document.content.split(/\r?\n/)[0] || ''
        });
      } else if (!/alwaysApply:\s*true/i.test(frontmatter)) {
        const hasGlobs = /globs:/i.test(frontmatter);
        const hasDescription = /description:\s*\S/i.test(frontmatter);
        if (!hasGlobs && !hasDescription) {
          findings.push({
            id: `${document.path}:inactive-frontmatter`,
            kind: 'inactive-frontmatter',
            severity: 'note',
            file: document.path,
            evidence: frontmatter.split(/\r?\n/)[1] || 'alwaysApply: false'
          });
        }
      }
    }
  }

  // The same sentence in two rule files is how two tools quietly start disagreeing.
  for (const [normalized, entries] of seen) {
    if (entries.length < 2) continue;
    const perFile = new Map<string, { line: number; evidence: string }[]>();
    for (const entry of entries) {
      const bucket = perFile.get(entry.file) || [];
      bucket.push({ line: entry.line, evidence: entry.evidence });
      perFile.set(entry.file, bucket);
    }

    for (const [file, bucket] of perFile) {
      if (bucket.length < 2) continue;
      findings.push({
        id: `${file}:duplicate:${normalized.slice(0, 40)}`,
        kind: 'duplicate-line',
        severity: 'problem',
        file,
        line: bucket[0].line,
        againstLines: bucket.slice(1).map((entry) => entry.line),
        evidence: bucket[0].evidence
      });
    }

    if (perFile.size > 1) {
      const files = [...perFile.keys()];
      for (let index = 1; index < files.length; index += 1) {
        const file = files[index];
        findings.push({
          id: `${file}:duplicate-across:${normalized.slice(0, 40)}`,
          kind: 'duplicate-across-files',
          severity: 'note',
          file,
          line: perFile.get(file)![0].line,
          evidence: perFile.get(file)![0].evidence,
          against: files[0]
        });
      }
    }
  }

  const problems = findings.filter((finding) => finding.severity === 'problem').length;
  return { findings, problems, notes: findings.length - problems, compared };
}

/**
 * The fixes that are safe to make without asking: dropping a line that repeats itself, dropping a
 * line that points at something the folder no longer has, and giving the Cursor file the frontmatter
 * without which Cursor ignores it. Contradictions are never "fixed" — deciding which half of a
 * contradiction is right is the author's call, not ours.
 */
export interface RulesFixOutcome {
  files: RuleFileToWrite[];
  removedDuplicates: number;
  removedBrokenReferences: number;
  addedFrontmatter: number;
}

export function fixRuleDocuments(
  documents: RuleFileToWrite[],
  findings: RuleFinding[],
  projectName: string
): RulesFixOutcome {
  const drop = new Map<string, Set<number>>();
  const addFrontmatter = new Map<string, boolean>();
  let removedDuplicates = 0;
  let removedBrokenReferences = 0;

  const dropLine = (file: string, line: number) => {
    const bucket = drop.get(file) || new Set<number>();
    bucket.add(line);
    drop.set(file, bucket);
  };

  for (const finding of findings) {
    if (finding.severity !== 'problem') continue;
    if (finding.kind === 'duplicate-line') {
      for (const line of finding.againstLines || []) {
        dropLine(finding.file, line);
        removedDuplicates += 1;
      }
    }
    if ((finding.kind === 'missing-file' || finding.kind === 'missing-command') && finding.line) {
      dropLine(finding.file, finding.line);
      removedBrokenReferences += 1;
    }
    if (finding.kind === 'missing-frontmatter') addFrontmatter.set(finding.file, true);
  }

  let addedFrontmatter = 0;

  const files = documents.map((document) => {
    const lines = document.content.split(/\r?\n/);
    const toDrop = drop.get(document.path);
    let content = toDrop ? lines.filter((_line, index) => !toDrop.has(index + 1)).join('\n') : document.content;

    if (addFrontmatter.get(document.path)) {
      const withFrontmatter = withCursorFrontmatter(content, projectName);
      if (withFrontmatter !== content) addedFrontmatter += 1;
      content = withFrontmatter;
    }

    // Dropping lines leaves a gap where they were; one blank line reads as a paragraph break.
    const trimmed = content.replace(/\n{3,}/g, '\n\n').trim();
    return { ...document, content: `${trimmed}\n` };
  });

  return { files, removedDuplicates, removedBrokenReferences, addedFrontmatter };
}
