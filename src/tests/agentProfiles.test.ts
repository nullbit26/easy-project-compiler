import { describe, it, expect } from 'vitest';
import {
  agentProfileFor,
  referenceFor,
  rulesFileLine,
  surfaceDescription,
  type AgentSurface,
  type ReferenceStyle
} from '../utils/agentProfiles';

/**
 * One approach per agent — but only where the approach actually differs.
 *
 * The picker lists eleven tools and the compiler used to tell them apart with a single boolean:
 * "does the name sound like a browser chat?". Everything else was handed the chat's contract, which
 * asks for complete files — and the official guidance for Cursor, Claude Code, Copilot, Cline, Roo
 * Code, Windsurf, Replit, Lovable and Bolt says the opposite: these tools read the project and edit
 * it themselves.
 *
 * Reading every vendor's October 2026 documentation per tool says the same thing in a second way:
 * the *shape* of a good task is identical everywhere (outcome, the files that matter, the
 * constraints, observable acceptance criteria, the command that proves it), no vendor documents a
 * house style, and an experiment that holds content fixed while varying only the markup finds no
 * better format. What varies is three things and only three: can the tool see the project, does it
 * edit in place or hand code back, and how does it want a file — and a rules file — named. The
 * table below is the picker, and each row is what that tool's own current documentation describes.
 * Sources, read October 2026, are listed in `agentProfiles.ts`.
 */

const PICKER: Array<[string, AgentSurface, ReferenceStyle, string | null]> = [
  ['DeepSeek / Web Chat', 'chat', 'target-file', null],
  ['ChatGPT / API', 'chat', 'target-file', null],
  ['Cursor', 'workspace', 'at', 'AGENTS.md'],
  ['Claude Code', 'workspace', 'at', 'CLAUDE.md'],
  ['Windsurf', 'workspace', 'at', 'AGENTS.md'],
  ['GitHub Copilot', 'workspace', 'hash-file', 'AGENTS.md'],
  ['Cline', 'workspace', 'at-root', 'AGENTS.md'],
  ['Roo Code', 'workspace', 'at-root', 'AGENTS.md'],
  ['Replit', 'builder', 'plain', null],
  ['Lovable', 'builder', 'plain', 'AGENTS.md'],
  ['Bolt', 'builder', 'plain', 'AGENTS.md']
];

describe('The agent behind the compiled prompt', () => {
  it('1. maps every entry of the picker to the surface its own documentation describes', () => {
    // Eleven rows, because eleven agents are on the list — a twelfth entry added to the picker
    // without a row here is a tool being written to with somebody else's contract.
    expect(PICKER).toHaveLength(11);

    for (const [name, surface, referenceStyle, rulesFile] of PICKER) {
      const profile = agentProfileFor(name);
      expect([name, profile.surface, profile.referenceStyle, profile.rulesFile]).toEqual([
        name,
        surface,
        referenceStyle,
        rulesFile
      ]);
      expect(profile.name).toBe(name);
    }

    // The three surfaces are all in use — a split into one would be no split at all.
    expect(new Set(PICKER.map(([, surface]) => surface)).size).toBe(3);
  });

  it('2. names a file the way that tool can actually attach it', () => {
    const path = 'src/App.tsx';

    // A chat has no mention syntax, so the file is labelled in the prompt itself — the same label
    // the review reads back out of the answer.
    expect(referenceFor(agentProfileFor('DeepSeek / Web Chat'), path)).toBe('Target File: src/App.tsx');
    expect(referenceFor(agentProfileFor('ChatGPT / API'), path)).toBe('Target File: src/App.tsx');

    expect(referenceFor(agentProfileFor('Cursor'), path)).toBe('@src/App.tsx');
    expect(referenceFor(agentProfileFor('Claude Code'), path)).toBe('@src/App.tsx');
    // Cline and Roo Code take paths from the workspace root, after the @.
    expect(referenceFor(agentProfileFor('Cline'), path)).toBe('@/src/App.tsx');
    expect(referenceFor(agentProfileFor('Roo Code'), path)).toBe('@/src/App.tsx');
    // VS Code Copilot chat is #file:; its CLI takes @path, which the brief names as well.
    expect(referenceFor(agentProfileFor('GitHub Copilot'), path)).toBe('#file:src/App.tsx');

    // A builder attaches nothing; the path is orientation, and inventing a mention for it would
    // read as an instruction to attach a file it has no syntax for.
    for (const builder of ['Lovable', 'Bolt', 'Replit']) {
      expect(referenceFor(agentProfileFor(builder), path)).toBe(path);
    }
  });

  it('3. points at the rules file the project actually has, in that tool’s own syntax', () => {
    // Every tool on the list reads the project's `AGENTS.md`; Claude Code is the single exception,
    // because it reads `CLAUDE.md` instead when both exist — which is why that file is a pointer.
    for (const name of ['Cursor', 'Windsurf', 'GitHub Copilot', 'Cline', 'Roo Code', 'Lovable', 'Bolt']) {
      expect(agentProfileFor(name).rulesFile).toBe('AGENTS.md');
    }
    expect(agentProfileFor('Claude Code').rulesFile).toBe('CLAUDE.md');

    // The line is the tool's own syntax: the same file, named three different ways.
    expect(rulesFileLine(agentProfileFor('Cursor'), false)).toContain('@AGENTS.md');
    expect(rulesFileLine(agentProfileFor('Claude Code'), false)).toContain('@CLAUDE.md');
    expect(rulesFileLine(agentProfileFor('Cline'), false)).toContain('@/AGENTS.md');
    expect(rulesFileLine(agentProfileFor('GitHub Copilot'), false)).toContain('#file:AGENTS.md');

    // And nothing at all where there is no file to open: a chat cannot read one, and Replit reads
    // its own `replit.md`, which this app does not write. A name it cannot open would be a lie in
    // the facts the compiler builds the task from.
    for (const name of ['DeepSeek / Web Chat', 'ChatGPT / API', 'Replit']) {
      expect(agentProfileFor(name).rulesFile).toBeNull();
      expect(rulesFileLine(agentProfileFor(name), false)).toBe('');
      expect(rulesFileLine(agentProfileFor(name), true)).toBe('');
    }

    // Both languages are written, and both name the file.
    expect(rulesFileLine(agentProfileFor('Cursor'), true)).toContain('AGENTS.md');
    expect(rulesFileLine(agentProfileFor('Cursor'), true)).toMatch(/прочита|лежат/);
  });

  it('4. describes the surface in words the compiler can use', () => {
    expect(surfaceDescription(agentProfileFor('Cursor'), true)).toContain('сам читает и правит файлы');
    expect(surfaceDescription(agentProfileFor('Cursor'), false)).toContain('reads and edits');
    expect(surfaceDescription(agentProfileFor('DeepSeek / Web Chat'), true)).toContain('только то, что принесёт');
    expect(surfaceDescription(agentProfileFor('Lovable'), false)).toContain('assembles and edits the project itself');
  });

  it('5. treats an unknown agent as a workspace agent, never as a chat', () => {
    // A tool that can read its project is only ever given a more precise task by this reading; a
    // chat handed a repository task with no repository would have to invent what it cannot see.
    for (const unknown of ['Antigravity', 'Gemini CLI', 'Something New (2027)']) {
      const profile = agentProfileFor(unknown);
      expect(profile.surface).toBe('workspace');
      expect(profile.referenceStyle).toBe('at');
      expect(profile.rulesFile).toBe('AGENTS.md');
    }
    expect(agentProfileFor('').surface).toBe('workspace');
  });

  it('6. reads a name the picker does not carry yet by its own family, not by its neighbour', () => {
    // The list has no Google entry yet; if one is added, these names must not fall through to the
    // workspace default's `@path`/`AGENTS.md` answer by accident. Replit's row is the reason this
    // test exists at all: it is on the list, it is a builder like the other two, and it is the one
    // that does *not* read `AGENTS.md`.
    expect(agentProfileFor('Replit').rulesFile).toBeNull();
    expect(agentProfileFor('Lovable').rulesFile).toBe('AGENTS.md');
    expect(agentProfileFor('Bolt').rulesFile).toBe('AGENTS.md');
    expect(agentProfileFor('Windsurf').surface).toBe('workspace');
    expect(agentProfileFor('Cascade').surface).toBe('workspace');
  });
});
