import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { agentProfileFor, referenceFor } from '../utils/agentProfiles';

/**
 * The documents in `docs/` are instructions to a person, and instructions go stale the way rules do.
 *
 * The table in `agentProfiles.ts` is the one place that says what each tool reads, how it wants a
 * file named and whether it edits the project itself — and it is the source these documents are
 * supposed to agree with. A document that quietly keeps an old syntax (`@file` for a chat, whole
 * files for an agent that edits in place) is worse than no document, because it reads as researched
 * while sending the reader to a command that does nothing.
 *
 * So the checks below are not about prose. They are about the three facts that actually change a
 * prompt: the mention syntax, the rules file, and the citation of where the claim came from.
 */

const DOCS_DIR = path.join(process.cwd(), 'docs', 'agents');
const MAIN_DOC = path.join(process.cwd(), 'docs', 'agent-prompting.md');

/** The picker, and the document that belongs to each row of it. */
const DOCS: Array<{ agent: string; file: string }> = [
  { agent: 'Cursor', file: 'cursor.md' },
  { agent: 'Claude Code', file: 'claude-code.md' },
  { agent: 'Windsurf', file: 'windsurf.md' },
  { agent: 'GitHub Copilot', file: 'github-copilot.md' },
  { agent: 'Cline', file: 'cline.md' },
  { agent: 'Roo Code', file: 'roo-code.md' },
  { agent: 'Lovable', file: 'lovable.md' },
  { agent: 'Bolt', file: 'bolt.md' },
  { agent: 'Replit', file: 'replit.md' },
  { agent: 'ChatGPT / API', file: 'chatgpt.md' },
  { agent: 'DeepSeek / Web Chat', file: 'deepseek.md' }
];

const read = (file: string) => fs.readFileSync(path.join(DOCS_DIR, file), 'utf8');

describe('The per-agent prompt documents', () => {
  it('1. covers every agent in the picker, and nothing named twice', () => {
    // Eleven agents on the list, eleven documents — a twelfth row added to the picker without a
    // document here is an agent getting a prompt nobody researched.
    expect(DOCS).toHaveLength(11);
    expect(new Set(DOCS.map((d) => d.file)).size).toBe(DOCS.length);

    for (const { file } of DOCS) {
      expect(fs.existsSync(path.join(DOCS_DIR, file))).toBe(true);
    }

    // A document for a tool that is on nobody's list: Google's agents are documented because the
    // per-agent questions about them keep coming up, and being explicit about that is the point.
    expect(fs.existsSync(path.join(DOCS_DIR, 'google.md'))).toBe(true);
  });

  it('2. names a file the way that agent can actually attach it, or says there is no syntax', () => {
    const sample = 'src/App.tsx';

    for (const { agent, file } of DOCS) {
      const profile = agentProfileFor(agent);
      const text = read(file);

      if (profile.referenceStyle === 'target-file') {
        // A chat has no mention syntax at all: the prompt labels the file instead.
        expect(text).toContain('Target File: ');
        expect(text).not.toContain(`@${sample}`);
        continue;
      }

      if (profile.referenceStyle === 'plain') {
        // A builder attaches nothing, and writing a mention for it would read as an instruction to
        // attach a file it has no syntax for.
        expect(text).not.toContain(`@${sample}`);
        expect(text).not.toContain(`#file:${sample}`);
        continue;
      }

      expect(text).toContain(referenceFor(profile, sample));
    }
  });

  it('3. names the rules file that tool reads, in the tool’s own syntax', () => {
    for (const { agent, file } of DOCS) {
      const profile = agentProfileFor(agent);
      const text = read(file);

      // Every document states the field, so a reader can see the answer even when it is "none".
      expect(text).toContain('Файл правил');

      if (profile.rulesFile) {
        // The file, and the reference to it, exactly as the compiled prompt emits them: the same
        // sentence every time, in each tool's own syntax.
        expect(text).toContain(profile.rulesFile);
        expect(text).toContain(referenceFor(profile, profile.rulesFile));
      }
    }

    // The two tools that read nothing this app writes have to say so out loud: a document that
    // silently omitted the line would look like an oversight rather than a researched answer.
    expect(read('replit.md')).toContain('replit.md');
    expect(read('chatgpt.md')).toContain('Codex');
    expect(read('deepseek.md')).toMatch(/нет|не относится/);
  });

  it('4. is reachable from the index, which is reachable from the main report', () => {
    const index = read('README.md');
    for (const { file } of [...DOCS, { agent: '', file: 'google.md' }]) {
      expect(index).toContain(`](${file})`);
    }

    const main = fs.readFileSync(MAIN_DOC, 'utf8');
    expect(main).toContain('](agents/README.md)');
    for (const { file } of [...DOCS, { agent: '', file: 'google.md' }]) {
      expect(main).toContain(`](agents/${file})`);
    }
  });

  it('5. cites its sources rather than asserting them', () => {
    for (const { file } of [...DOCS, { agent: '', file: 'google.md' }]) {
      const text = read(file);
      expect(text).toContain('## Источники');
      const links = text.match(/https?:\/\/[^\s)]+/g) || [];
      // One link is a gesture; a document about what a vendor documents needs several.
      expect(links.length).toBeGreaterThanOrEqual(3);
    }

    // And the report the documents rest on cites the research, not only the vendors.
    const main = fs.readFileSync(MAIN_DOC, 'utf8');
    expect(main).toContain('arxiv.org');
  });
});
