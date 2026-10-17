/**
 * What the compiled prompt may assume about the agent it is written for.
 *
 * The picker lists eleven tools and the compiler used to know exactly one thing about them: whether
 * the name sounded like a browser chat. Everything that was not a chat got the same treatment, and
 * it was the wrong one — Cursor, Claude Code, Cline, Copilot and Windsurf were handed "return the
 * complete file, do not shorten it", while their own documentation says the opposite: they read the
 * repository and edit it in place, and a prompt that asks for whole files is asking them to do the
 * work twice. The other direction was just as wrong: Replit, Lovable and Bolt own the project and
 * were being told how to label output blocks they never print.
 *
 * Three surfaces cover what actually changes a prompt:
 *   • a workspace agent reads and edits the project itself — name the goal, the files and the
 *     checks, and never ask for file contents;
 *   • a chat sees only what the prompt carries — the contents have to be asked for, one labelled
 *     block per file;
 *   • a builder owns the project and takes an intent plus its boundaries — what changes, what must
 *     not, one meaningful change at a time.
 *
 * What the vendors' own guidance of October 2026 does and does not ask for.
 *
 * It asks, unanimously, for the same five things in a task: the outcome, the files that matter, the
 * constraints and what must not change, observable acceptance criteria, and the command that proves
 * the work (Cursor's prompting page, Claude Code's best practices and `/prompt-library`, VS Code's
 * best practices, Roo Code's prompt-engineering tips, Replit's effective-prompting guide, Bolt's
 * prompting guide, Lovable's prompting-one). It asks for nothing per tool beyond that: no vendor
 * documents a house *style*, and the one experiment that holds a prompt's content fixed and varies
 * only its markup (arXiv 2411.10541) finds no universally better format. The 2026 evaluation of
 * repository context files (arXiv 2602.11988) goes further in the same direction: unnecessary
 * requirements in a standing instruction file made agents *worse* and more expensive on its
 * benchmark, so per-agent wording that adds no information is not a feature.
 *
 * What genuinely differs is three things, and they are all that is encoded here:
 *   1. whether the tool can see the project at all;
 *   2. whether it edits in place or hands code back;
 *   3. how a file, and a rules file, is named — and this is not portable: `@path` in Cursor and
 *      Claude Code, `@/path` from the workspace root in Cline and Roo Code, `#file:` in VS Code
 *      Copilot with `@path` in its CLI, a plain path for the tools that attach nothing, and a
 *      "Target File:" label for a chat, which has no mention syntax at all.
 *
 * The fourth column records the standing rules file this tool reads *out of the ones this app
 * writes* (`rulesFiles.ts` writes `AGENTS.md`, a one-line pointer `CLAUDE.md`, and Cursor's
 * `.cursor/rules/project.mdc`). It is the one per-tool fact worth acting on, because the tools have
 * converged on `AGENTS.md` and only a few insist on their own name — and a file name the project
 * does not have would be a lie in the prompt's facts. Native directories a tool also reads
 * (`.cursor/rules`, `.devin/rules`, `.clinerules`, `.roo/rules`) are noted with their entry rather
 * than listed here, because listing one would point the agent at a path this app never creates.
 *
 * Sources, read October 2026:
 *   cursor.com/docs/rules, /docs/agent/prompting, /docs/agent/plan-mode, /docs/agent/overview;
 *   code.claude.com/docs/en/memory, /best-practices, /common-workflows, /prompt-library;
 *   docs.devin.ai/desktop/cascade (Windsurf's docs now live here), /cascade/agents-md,
 *   docs.windsurf.com/best-practices/prompt-engineering;
 *   code.visualstudio.com/docs/agent-customization/custom-instructions, /docs/agents/best-practices,
 *   docs.github.com (Copilot cloud agent task guidance, Copilot CLI custom instructions);
 *   docs.cline.bot/customization/cline-rules, /core-workflows/plan-and-act, /core-workflows/working-with-files;
 *   docs.roocode.com/basic-usage/context-mentions, /features/custom-instructions, /advanced-usage/prompt-engineering;
 *   docs.lovable.dev/prompting/prompting-one, /features/knowledge, /features/chat-mode, /features/plan-mode;
 *   support.bolt.new/prompting/prompting-effectively, /prompting/plan-mode, /prompting/manage-context;
 *   docs.replit.com/learn/effective-prompting, /features/project-setup/replit-dot-md;
 *   agents.md; help.openai.com (Projects, custom instructions, desktop app), ai.google.dev/gemini-api/docs/prompting-strategies.
 */

/** The three ways a target agent relates to the project. */
export type AgentSurface = 'workspace' | 'chat' | 'builder';

/**
 * How files are named so the tool can pull them into context.
 *
 * `plain` is not a syntax: it is what a builder needs, because it reads the project on its own and
 * the file list in the prompt is orientation, not an instruction to attach anything.
 */
export type ReferenceStyle = 'at' | 'hash-file' | 'at-root' | 'target-file' | 'plain';

export interface AgentProfile {
  /** The name exactly as the picker shows it, for the brief to quote back. */
  name: string;
  surface: AgentSurface;
  referenceStyle: ReferenceStyle;
  /**
   * The project's standing rules file that this tool reads, or `null` when it reads none of them.
   *
   * Only files this app actually writes are named here — `AGENTS.md`, or the `CLAUDE.md` pointer
   * for the one tool that reads that instead. `null` is a real answer, not a gap to fill: a chat
   * cannot open a file at all, and Replit reads `replit.md`, which this app does not write, so
   * pointing it at `AGENTS.md` would name a file that is not there.
   */
  rulesFile: string | null;
}

const AGENTS_MD = 'AGENTS.md';

const PROFILES: Array<{ match: string[]; profile: Omit<AgentProfile, 'name'> }> = [
  /*
   * Chats: they cannot see the project, so the prompt has to carry it.
   *
   * OpenAI's own documentation is explicit that this is a per-surface question, not a per-company
   * one: ChatGPT's desktop app has Work and Codex experiences that *can* open a local folder and
   * read `AGENTS.md`, while its Chat, Canvas and Projects surfaces cannot, and a Project's
   * instructions are not a repository file. The picker entry is the chat, so the chat is what is
   * assumed; the desktop reading is a separate profile the day the picker grows one.
   */
  { match: ['deepseek', 'chatgpt', 'чат', 'web chat', 'браузер', 'api'], profile: { surface: 'chat', referenceStyle: 'target-file', rulesFile: null } },

  /*
   * Builders: they build and edit the project themselves; the prompt is an intent, not a handover.
   *
   * The three are not identical, and the differences are worth recording even where they do not
   * change the words: Lovable reads root `AGENTS.md` and `CLAUDE.md` and takes `@` file references;
   * Bolt finds `agents.md` on its own and targets files through its UI rather than a mention;
   * Replit reads its own root `replit.md` and documents no `AGENTS.md` support at all.
   */
  { match: ['lovable'], profile: { surface: 'builder', referenceStyle: 'plain', rulesFile: AGENTS_MD } },
  // Bolt's own docs spell the file `agents.md`; that is the same file on the case-insensitive
  // filesystems this desktop app runs on, and `AGENTS.md` is the spelling the convention and every
  // other tool on this list use.
  { match: ['bolt'], profile: { surface: 'builder', referenceStyle: 'plain', rulesFile: AGENTS_MD } },
  // Replit's standing instructions live in `replit.md`, which this app does not write. Naming
  // `AGENTS.md` here would point the agent at a file Replit never reads and the project never had.
  { match: ['replit'], profile: { surface: 'builder', referenceStyle: 'plain', rulesFile: null } },

  // Workspace agents: each with the mention syntax and rules file its own docs use.
  // Cursor only applies `.mdc` files under `.cursor/rules` — which is exactly what this app writes —
  // and reads a plain `AGENTS.md` as the simpler alternative.
  { match: ['cursor'], profile: { surface: 'workspace', referenceStyle: 'at', rulesFile: AGENTS_MD } },
  // Claude Code reads `CLAUDE.md` *instead of* `AGENTS.md` when both exist (native `AGENTS.md`
  // support arrived in v2.1.277 and the documented fallback is `@AGENTS.md` inside `CLAUDE.md`),
  // which is why the app's `CLAUDE.md` is a one-line pointer rather than a second copy.
  { match: ['claude'], profile: { surface: 'workspace', referenceStyle: 'at', rulesFile: 'CLAUDE.md' } },
  // Windsurf's documentation now redirects to docs.devin.ai and describes Devin Desktop; the rules
  // it reads are `.devin/rules/` with `.windsurf/rules/` kept as the legacy fallback, and
  // `AGENTS.md` is read through the same engine.
  { match: ['windsurf', 'cascade'], profile: { surface: 'workspace', referenceStyle: 'at', rulesFile: AGENTS_MD } },
  // VS Code Copilot attaches a file with `#file:` in chat and `@path` from the CLI; it reads
  // `AGENTS.md` anywhere in the repository — the nearest one is the one that applies.
  { match: ['copilot'], profile: { surface: 'workspace', referenceStyle: 'hash-file', rulesFile: AGENTS_MD } },
  // Cline and Roo Code take `@/path` from the workspace root (a trailing slash means a folder) and
  // both read the project's `AGENTS.md` on top of their own `.clinerules` / `.roo/rules`.
  { match: ['cline'], profile: { surface: 'workspace', referenceStyle: 'at-root', rulesFile: AGENTS_MD } },
  { match: ['roo'], profile: { surface: 'workspace', referenceStyle: 'at-root', rulesFile: AGENTS_MD } }
];

/**
 * The profile for a name from the picker.
 *
 * Anything unrecognised is treated as a workspace agent — the safest reading, because a tool that
 * can read its project is only ever given a more precise task, while a chat handed a repository task
 * with no repository would have to invent what it cannot see.
 */
export function agentProfileFor(agentName: string): AgentProfile {
  const name = (agentName || '').trim() || 'Cursor';
  const lower = name.toLowerCase();
  const found = PROFILES.find((entry) => entry.match.some((token) => lower.includes(token)));
  const profile = found?.profile || {
    surface: 'workspace' as const,
    referenceStyle: 'at' as const,
    rulesFile: AGENTS_MD
  };
  return { name, ...profile };
}

/** How a target file is named in the finished prompt, per the tool's own mention syntax. */
export function referenceFor(profile: AgentProfile, path: string): string {
  switch (profile.referenceStyle) {
    case 'at':
      return `@${path}`;
    case 'at-root':
      return `@/${path}`;
    case 'hash-file':
      return `#file:${path}`;
    case 'target-file':
      return `Target File: ${path}`;
    default:
      return path;
  }
}

/**
 * Where the project keeps its standing rules, in the tool's own reference syntax — or nothing.
 *
 * This is the one place the table above pays for itself. The rules themselves are carried into the
 * prompt by the rules check; this line adds the one thing that check cannot: the agent is told the
 * rules also live in the project, and told in the syntax that lets it open them, so a later task
 * finds them without being pasted them again.
 */
export function rulesFileLine(profile: AgentProfile, isRu: boolean): string {
  if (!profile.rulesFile) return '';
  const file = profile.rulesFile;
  /*
   * The mention is offered only where the tool has one. A builder's profile is `plain` by design —
   * it takes no file reference at all — and writing "(AGENTS.md)" after the file name would be the
   * prompt explaining the path to itself.
   */
  const mention =
    profile.referenceStyle === 'plain' || profile.referenceStyle === 'target-file'
      ? null
      : referenceFor(profile, file);
  if (isRu) {
    return mention
      ? `\n- Договорённости проекта лежат в \`${file}\` — прочитай их (${mention}) и не противоречь им.`
      : `\n- Договорённости проекта лежат в \`${file}\` — сверься с ними и не противоречь им.`;
  }
  return mention
    ? `\n- The project's standing conventions live in \`${file}\` — read them (${mention}) and do not contradict them.`
    : `\n- The project's standing conventions live in \`${file}\` — follow them and do not contradict them.`;
}

/** A one-line description of the surface, for the facts the compiler is given. */
export function surfaceDescription(profile: AgentProfile, isRu: boolean): string {
  if (profile.surface === 'chat') {
    return isRu
      ? 'чат без доступа к файлам проекта: он видит только то, что принесёт сам промпт'
      : 'a chat with no access to the project files: it sees only what the prompt carries';
  }
  if (profile.surface === 'builder') {
    return isRu
      ? 'конструктор: он сам собирает и правит проект, промпт для него — намерение и границы'
      : 'a builder: it assembles and edits the project itself, so the prompt is intent and boundaries';
  }
  return isRu
    ? 'агент внутри редактора: он сам читает и правит файлы проекта'
    : 'an agent inside the editor: it reads and edits the files of the project itself';
}
