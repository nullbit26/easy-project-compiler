import { describe, it, expect } from 'vitest';

import {
  RULES_FILE_PATHS,
  claudePointerDocument,
  cursorFrontmatter,
  ruleFilesToWrite,
  withCursorFrontmatter
} from '../utils/rulesFiles';
import { generateCustomRulesFiles } from '../utils/rulesGenerator';
import type { AgentType } from '../types';

/**
 * What lands in the folder has to be a file the tool actually reads, and it has to be the same
 * text the screen showed. These tests hold both ends: the format rules of each tool, and the fact
 * that the panel and the write agree byte for byte.
 */

const content = {
  agentsMd: '# AGENTS.md\n\n- Tower defence rules\n',
  claudeMd: '# CLAUDE.md - pointer\n',
  cursorRules: '# Rules for Cursor AI\n\n- Keep the grid logic pure\n'
};

describe('The three rule files', () => {
  it('1. writes them where the tools actually look for them', () => {
    expect(RULES_FILE_PATHS).toEqual({
      agents: 'AGENTS.md',
      claude: 'CLAUDE.md',
      cursor: '.cursor/rules/project.mdc'
    });
  });

  it('2. writes exactly the text the panel is showing', () => {
    const files = ruleFilesToWrite(content, 'Island Survival');

    expect(files.map((file) => file.path)).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      '.cursor/rules/project.mdc'
    ]);
    // The panel's text is the file's text: only the closing newline is added for disk.
    expect(files[0].content).toBe(`${content.agentsMd.trim()}\n`);
    expect(files[1].content).toBe(`${content.claudeMd.trim()}\n`);
    // The Cursor file gains its frontmatter; nothing else about it changes.
    expect(files[2].content).toContain('- Keep the grid logic pure');
    expect(files.every((file) => file.content.endsWith('\n') && !file.content.endsWith('\n\n'))).toBe(true);
  });

  it('3. never hands the write an empty file, which the folder would refuse anyway', () => {
    const files = ruleFilesToWrite(content, 'Island Survival');
    expect(files.every((file) => file.content.trim().length > 0)).toBe(true);
  });
});

describe('The Cursor rule', () => {
  it('4. carries the frontmatter without which Cursor ignores the rule', () => {
    const frontmatter = cursorFrontmatter('Island Survival');

    expect(frontmatter.startsWith('---\n')).toBe(true);
    expect(frontmatter).toContain('description: Project rules for Island Survival');
    expect(frontmatter).toContain('alwaysApply: true');
    expect(frontmatter.trimEnd().endsWith('---')).toBe(true);
  });

  it('5. does not stack a second frontmatter on a document that has one', () => {
    const already = '---\ndescription: Mine\nalwaysApply: false\n---\n\nBody\n';
    expect(withCursorFrontmatter(already, 'Demo')).toBe(already);

    const once = withCursorFrontmatter('Body only\n', 'Demo');
    expect(once.match(/^---$/gm)).toHaveLength(2);
  });
});

describe('CLAUDE.md as a pointer', () => {
  it('6. imports AGENTS.md instead of copying the rules', () => {
    const ru = claudePointerDocument('Island Survival', true);
    const en = claudePointerDocument('Island Survival', false);

    for (const document of [ru, en]) {
      expect(document).toContain('@AGENTS.md');
      expect(document).toContain('Island Survival');
      // A pointer is short by construction; the rules themselves are not repeated here.
      expect(document.length).toBeLessThan(700);
    }

    expect(ru).toContain('Правьте `AGENTS.md`');
    expect(en).toContain('Edit `AGENTS.md`');
  });
});

describe('What the generator now produces', () => {
  const base = {
    projectName: 'Island Survival',
    projectType: 'Unity' as const,
    engineOrFramework: 'Unity 6 (URP)',
    language: 'C#',
    reliabilityGuarantees: ['Strict Typing'],
    uiLanguage: 'ru' as const
  };

  it('7. hands the panel a CLAUDE.md that points at AGENTS.md', () => {
    const rules = generateCustomRulesFiles({ ...base, selectedAgent: 'Claude Code' });

    expect(rules.claudeMd).toContain('@AGENTS.md');
    expect(rules.claudeMd).not.toContain('## Архитектурные правила');
  });

  it('8. hands the panel a Cursor document that is ready to be read by Cursor', () => {
    const rules = generateCustomRulesFiles({ ...base, selectedAgent: 'Cursor' });

    expect(rules.cursorRules.startsWith('---\n')).toBe(true);
    expect(rules.cursorRules).toContain('alwaysApply: true');
    expect(rules.cursorRules).toContain('Island Survival');
    // The document names the file it is meant to be, not the legacy one it is not.
    expect(rules.cursorRules).not.toContain('.cursorrules');
  });

  it('9. keeps all three documents non-empty for every agent the app supports', () => {
    const agents: AgentType[] = [
      'Cursor',
      'Claude Code',
      'Windsurf',
      'GitHub Copilot',
      'Cline',
      'Roo Code',
      'Replit',
      'Lovable',
      'Bolt',
      'ChatGPT / API',
      'DeepSeek / Web Chat'
    ];

    for (const selectedAgent of agents) {
      const rules = generateCustomRulesFiles({ ...base, selectedAgent });
      for (const text of [rules.agentsMd, rules.claudeMd, rules.cursorRules]) {
        expect(text.trim().length).toBeGreaterThan(0);
      }
      expect(rules.cursorRules.match(/^---$/gm)).toHaveLength(2);
    }
  });

  it('10. writes the rules in the language the user reads the app in', () => {
    const ru = generateCustomRulesFiles({ ...base, selectedAgent: 'Cursor', uiLanguage: 'ru' });
    const en = generateCustomRulesFiles({ ...base, selectedAgent: 'Cursor', uiLanguage: 'en' });

    expect(ru.claudeMd).toContain('указатель');
    expect(en.claudeMd).toContain('pointer');
    expect(en.cursorRules).toContain('Project rules for Island Survival');
  });
});
