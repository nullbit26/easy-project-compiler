/**
 * Where the agent rules go when they leave the screen.
 *
 * The three files are not three copies of one document:
 *  - `AGENTS.md` is the document itself — the convention the widest set of tools reads;
 *  - `CLAUDE.md` is a pointer, because Claude Code reads *this* file instead of `AGENTS.md` when
 *    both exist, so a second copy would drift and one of the two would silently stop applying;
 *  - `.cursor/rules/project.mdc` is the Cursor rule, and it is a `.mdc` file with frontmatter
 *    because Cursor ignores a plain `.md` in that directory entirely.
 *
 * Whatever this module returns is exactly what the panel shows and exactly what gets written.
 */

export const RULES_FILE_PATHS = {
  agents: 'AGENTS.md',
  claude: 'CLAUDE.md',
  cursor: '.cursor/rules/project.mdc'
} as const;

export type RulesFileKey = keyof typeof RULES_FILE_PATHS;

export interface RulesContent {
  agentsMd: string;
  claudeMd: string;
  cursorRules: string;
}

export interface RuleFileToWrite {
  key: RulesFileKey;
  path: string;
  content: string;
}

/** Cursor only reads `.mdc`, and without this frontmatter the rule is not applied at all. */
export function cursorFrontmatter(projectName: string): string {
  return ['---', `description: Project rules for ${projectName}`, 'alwaysApply: true', '---', ''].join('\n');
}

/** Adds the frontmatter once, so a document that already carries it is never doubled up. */
export function withCursorFrontmatter(body: string, projectName: string): string {
  const trimmed = body.trimStart();
  if (trimmed.startsWith('---')) return body;
  return `${cursorFrontmatter(projectName)}${body}`;
}

/**
 * The three files, in the order they are written, ready for the write API. Each one ends with a
 * single newline: a text file without one is the kind of detail that shows up as a dirty diff in
 * someone's repository.
 */
export function ruleFilesToWrite(content: RulesContent, projectName: string): RuleFileToWrite[] {
  const document = (value: string) => `${(value || '').trim()}\n`;
  return [
    { key: 'agents', path: RULES_FILE_PATHS.agents, content: document(content.agentsMd) },
    { key: 'claude', path: RULES_FILE_PATHS.claude, content: document(content.claudeMd) },
    {
      key: 'cursor',
      path: RULES_FILE_PATHS.cursor,
      content: document(withCursorFrontmatter((content.cursorRules || '').trim(), projectName).trimEnd())
    }
  ];
}

/**
 * The CLAUDE.md that gets written: a pointer and the reason for it, so whoever opens the file
 * understands why it is short and where to edit the rules.
 */
export function claudePointerDocument(projectName: string, isRu: boolean): string {
  const importLine = '@AGENTS.md';
  if (!isRu) {
    return [
      '# CLAUDE.md — a pointer to AGENTS.md',
      '',
      `The rules for **${projectName}** live in one place: \`AGENTS.md\`.`,
      '',
      importLine,
      '',
      'Claude Code reads `CLAUDE.md` instead of `AGENTS.md` when both files exist, so this file holds',
      'no copy of the rules: a copy drifts away from the original sooner or later, and one of the two',
      'versions then quietly stops applying. Edit `AGENTS.md`; this file only points at it.',
      ''
    ].join('\n');
  }

  return [
    '# CLAUDE.md — указатель на AGENTS.md',
    '',
    `Правила проекта **${projectName}** лежат в одном месте: \`AGENTS.md\`.`,
    '',
    importLine,
    '',
    'Claude Code читает `CLAUDE.md` вместо `AGENTS.md`, если есть оба файла. Поэтому копии правил',
    'здесь нет: копия рано или поздно разошлась бы с оригиналом, и одна из двух версий молча',
    'перестала бы действовать. Правьте `AGENTS.md` — этот файл только указывает на него.',
    ''
  ].join('\n');
}
