import { auditRules, scriptsFromManifest, type RuleAuditResult, type RuleFinding } from '../../src/utils/rulesAudit';
import { ruleFilesToWrite, type RulesContent } from '../../src/utils/rulesFiles';
import { formatRulesCheckTime } from '../../src/utils/rulesCheckStamp';
import { getWorkspaceRoot } from '../store/workspaceStore';
import { readWorkspaceTextFile, scanWorkspace } from '../services/workspaceFiles';

/**
 * The rules files are the one document in a project nobody re-reads — and they are also the document
 * the compiled prompt is built on top of. When a rule points at a file the folder no longer has, or
 * calls a script package.json never declared, an agent that follows it invents work: it writes code
 * for a path that does not exist, or runs a command that cannot run.
 *
 * So the compiled prompt carries the answer: which lines of the rules are stale, read off the real
 * folder, and what the agent may not do with them. The check itself is `auditRules` — the same
 * module the rules panel runs — because a second implementation would sooner or later disagree with
 * the first, and then one of the two would be telling the user a lie.
 *
 * What this module will not do: claim anything about files or commands when no folder is connected.
 * "The script is not declared" is a fact only about a folder somebody actually looked at.
 */

export interface FolderFacts {
  /** How many files the folder held when the rules were checked. */
  files: number;
  /** The scripts its package.json declares, or null when the folder has none. */
  scripts: string[] | null;
  /** Whether a folder is connected at all. */
  connected: boolean;
}

export interface RulesCheckOutcome {
  audit: RuleAuditResult;
  facts: FolderFacts;
  /**
   * When this check ran. The rules are read against a folder that keeps changing, so the facts in
   * here are facts about a moment: the prompt dates them, and the screen can say when the agent's
   * information was read instead of leaving the reader to guess.
   */
  checkedAt: string;
}

/** At most this many findings reach the prompt; the rest is a count, not a wall of text. */
const MAX_FINDINGS_IN_PROMPT = 12;
/** A quoted line is there to be recognised, not to be read in full. */
const MAX_EVIDENCE = 160;

interface FolderRead extends FolderFacts {
  /** Project-relative paths, or null when there is nothing that could be read. */
  paths: string[] | null;
}

/**
 * What the connected folder really holds, read once per compile. The file list comes from the same
 * walk the Project Files screen uses, and a missing package.json is an answer, not a failure.
 *
 * A folder that exists but cannot be walked is *not* an empty folder: `paths` stays null so the
 * check reports "not compared" rather than calling every reference in the rules broken.
 */
function readFolder(): FolderRead {
  const root = getWorkspaceRoot();
  if (!root) return { paths: null, scripts: null, connected: false, files: 0 };

  let paths: string[] | null = [];
  try {
    paths = scanWorkspace().files.map((file) => file.path);
  } catch {
    paths = null;
  }

  let scripts: string[] | null = null;
  try {
    scripts = scriptsFromManifest(readWorkspaceTextFile('package.json').content);
  } catch {
    scripts = null;
  }

  return { paths, scripts, connected: true, files: paths ? paths.length : 0 };
}

export function folderFactsForRules(): FolderFacts {
  const read = readFolder();
  return { files: read.files, scripts: read.scripts, connected: read.connected };
}

/**
 * Checks the documents that would be written against the folder. Null when there are no rules.
 * The clock is a parameter so a test can pin the sentence that carries the check time.
 */
export function checkRulesAgainstFolder(
  rules: RulesContent | null | undefined,
  projectName: string,
  at: Date = new Date()
): RulesCheckOutcome | null {
  if (!rules || typeof rules.agentsMd !== 'string') return null;

  const read = readFolder();
  const facts: FolderFacts = { files: read.files, scripts: read.scripts, connected: read.connected };

  const audit = auditRules({
    documents: ruleFilesToWrite(rules, projectName),
    workspacePaths: read.paths,
    packageScripts: read.scripts
  });

  return { audit, facts, checkedAt: at.toISOString() };
}

const TITLES = {
  ru: '## Проверка правил проекта: где они разошлись с папкой',
  en: '## Project rules checked against the folder: where they no longer hold'
};

export function rulesSectionTitle(isRu: boolean): string {
  return isRu ? TITLES.ru : TITLES.en;
}

function quote(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > MAX_EVIDENCE ? `${trimmed.slice(0, MAX_EVIDENCE - 1)}…` : trimmed;
}

/** One finding, as the agent has to read it: what is wrong, and what not to do about it. */
export function describeFinding(finding: RuleFinding, isRu: boolean): string {
  const where = finding.line ? `${finding.file}:${finding.line}` : finding.file;
  const also = finding.againstLines?.length ? ` (${isRu ? 'и ещё строки' : 'also lines'} ${finding.againstLines.join(', ')})` : '';

  switch (finding.kind) {
    case 'missing-file':
      return isRu
        ? `${where}${also} — ссылка на «${finding.missing}», которого в папке нет. Не считайте, что этот файл существует: если он нужен для задачи, скажите об этом, а не придумывайте его содержимое.`
        : `${where}${also} — points at \`${finding.missing}\`, which the folder does not have. Do not assume this file exists: if the task needs it, say so instead of inventing its contents.`;
    case 'missing-command':
      return isRu
        ? `${where}${also} — команда «${finding.missing}» ${
            finding.context === 'no-package-json' ? 'не может быть выполнена: в папке нет package.json' : 'не объявлена в package.json'
          }. Не запускайте её.`
        : `${where}${also} — \`${finding.missing}\` ${
            finding.context === 'no-package-json' ? 'cannot be run: the folder has no package.json' : 'is not declared in package.json'
          }. Do not run it.`;
    case 'contradiction':
      return isRu
        ? `${where}${also} — противоречие со строкой «${quote(finding.against || '')}»: «${quote(finding.evidence)}». Не выбирайте сторону молча: спросите пользователя.`
        : `${where}${also} — contradicts the line "${quote(finding.against || '')}": "${quote(finding.evidence)}". Do not silently pick a side: ask the user.`;
    case 'duplicate-line':
      return isRu
        ? `${where}${also} — одно и то же указание повторяется: «${quote(finding.evidence)}».`
        : `${where}${also} — the same instruction is repeated: "${quote(finding.evidence)}".`;
    case 'duplicate-across-files':
      return isRu
        ? `${where}${also} — то же указание есть в «${finding.against}»: правила могут разойтись.`
        : `${where}${also} — the same instruction lives in "${finding.against}": the two files can drift apart.`;
    case 'missing-frontmatter':
      return isRu
        ? `${where} — нет frontmatter, поэтому Cursor не станет читать этот файл правил.`
        : `${where} — no frontmatter, so Cursor would not read this rules file at all.`;
    case 'inactive-frontmatter':
      return isRu
        ? `${where} — правило не применяется само по себе (нет ни globs, ни description): не рассчитывайте, что агент его увидит.`
        : `${where} — the rule can never apply by itself (no globs, no description): do not count on the agent seeing it.`;
    case 'empty-document':
      return isRu
        ? `${finding.file} — в файле нет ни одного указания.`
        : `${finding.file} — the file holds no instruction at all.`;
    default:
      return `${where} — ${quote(finding.evidence)}`;
  }
}

/**
 * The section as it lands in the compiled prompt. Three honest shapes: findings, nothing found, and
 * "there was no folder to compare with" — the last one says what was not checked instead of
 * implying the rules are fine.
 */
export function renderRulesSection(outcome: RulesCheckOutcome, isRu: boolean): string {
  const { audit, facts } = outcome;
  const when = formatRulesCheckTime(outcome.checkedAt);
  const lines: string[] = [rulesSectionTitle(isRu)];

  if (!audit.compared.files) {
    // A folder that is connected but could not be read is not the same as no folder — saying the
    // wrong one of the two would be a claim about a folder nobody looked at.
    if (!facts.connected) {
      lines.push(
        isRu
          ? 'Папка проекта не подключена, поэтому ссылки на файлы и команды в правилах не сверялись. Не выдумывайте файлы, которых не видели: если правило ссылается на путь, которого нет среди файлов проекта, скажите об этом.'
          : 'No project folder is connected, so file references and commands in the rules were not checked. Do not invent files you have not seen: if a rule points at a path that is not among the project files, say so.'
      );
    } else {
      lines.push(
        isRu
          ? 'Список файлов папки прочитать не удалось, поэтому ссылки на файлы и команды не сверялись. Не выдумывайте файлы, которых не видели: если правило ссылается на путь, которого нет среди файлов проекта, скажите об этом.'
          : 'The folder could not be listed, so file references and commands in the rules were not checked. Do not invent files you have not seen: if a rule points at a path that is not among the project files, say so.'
      );
    }
    return lines.join('\n');
  }

  const folder = isRu
    ? `Проверено по папке проекта (файлов: ${facts.files}, команд в package.json: ${facts.scripts ? facts.scripts.length : 0}; сверка: ${when}).`
    : `Checked against the real project folder (files: ${facts.files}, package.json scripts: ${facts.scripts ? facts.scripts.length : 0}; checked at: ${when}).`;

  const stale = audit.findings.filter((finding) => finding.severity === 'problem');
  const notes = audit.findings.filter((finding) => finding.severity === 'note');

  if (audit.findings.length === 0) {
    lines.push(
      isRu
        ? `${folder} Расхождений нет: правила описывают эту папку. Следуйте им как есть.`
        : `${folder} Nothing disagrees: the rules describe this folder. Follow them as they are.`
    );
    return lines.join('\n');
  }

  lines.push(
    isRu
      ? `${folder} Эти строки правил устарели: ${stale.length} проблем, ${notes.length} заметок.`
      : `${folder} These lines of the rules no longer hold: ${stale.length} problems, ${notes.length} notes.`
  );

  if (stale.length > 0) {
    lines.push(
      isRu
        ? 'Не выполняйте перечисленное ниже и не ссылайтесь на него; остальные правила проекта действуют полностью:'
        : 'Do not act on the following and do not reference it; every other rule stays in force:'
    );
    stale.slice(0, MAX_FINDINGS_IN_PROMPT).forEach((finding, index) => {
      lines.push(`${index + 1}. ${describeFinding(finding, isRu)}`);
    });
    if (stale.length > MAX_FINDINGS_IN_PROMPT) {
      lines.push(
        isRu
          ? `…и ещё ${stale.length - MAX_FINDINGS_IN_PROMPT} — полный список в панели «Карта проекта».`
          : `…and ${stale.length - MAX_FINDINGS_IN_PROMPT} more — the full list is on the Project Map screen.`
      );
    }
  }

  if (notes.length > 0) {
    lines.push(isRu ? 'Заметки, которые работе не мешают:' : 'Notes that do not block the work:');
    notes.slice(0, MAX_FINDINGS_IN_PROMPT).forEach((finding) => {
      lines.push(`- ${describeFinding(finding, isRu)}`);
    });
  }

  return lines.join('\n');
}
