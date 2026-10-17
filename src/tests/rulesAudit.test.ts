import { describe, it, expect } from 'vitest';

import { auditRules, fixRuleDocuments, referencedPaths, referencedScripts } from '../utils/rulesAudit';
import type { RuleFinding } from '../utils/rulesAudit';
import { RULES_FILE_PATHS, type RuleFileToWrite } from '../utils/rulesFiles';

/**
 * The rules checker has one job to be worth having: every finding it prints must be true, and it
 * must say plainly what it could not check. A checker that cries wolf about a glob or a URL gets
 * switched off, and then it catches nothing at all.
 */

function doc(key: RuleFileToWrite['key'], body: string): RuleFileToWrite {
  return { key, path: RULES_FILE_PATHS[key], content: `${body}\n` };
}

const cleanCursorDoc = doc(
  'cursor',
  ['---', 'description: Project rules', 'alwaysApply: true', '---', '', '# Rules', '', '- Keep the grid logic pure and tested'].join('\n')
);

function audit(
  documents: RuleFileToWrite[],
  options: { paths?: string[] | null; scripts?: string[] | null } = {}
) {
  return auditRules({
    documents,
    workspacePaths: options.paths === undefined ? ['src/main.js', 'package.json'] : options.paths,
    packageScripts: options.scripts === undefined ? ['test', 'build'] : options.scripts
  });
}

const kinds = (findings: RuleFinding[]) => findings.map((finding) => finding.kind);

describe('Reading references out of a rule', () => {
  it('1. takes a path out of backticks and out of bare text', () => {
    const paths = referencedPaths('- Edit `src/App.tsx` and keep Assets/Features/Player/PlayerHealth.cs in sync');

    expect(paths).toContain('src/App.tsx');
    expect(paths).toContain('Assets/Features/Player/PlayerHealth.cs');
  });

  it('2. leaves globs, URLs, placeholders and absolute paths alone', () => {
    const paths = referencedPaths(
      '- Match src/**/*.tsx, see https://react.dev/reference/rsc/server-components and C:\\Users\\me\\app.tsx, plus `<Target File: src/App.tsx>`'
    );

    expect(paths.some((path) => path.includes('*'))).toBe(false);
    expect(paths.some((path) => path.startsWith('http'))).toBe(false);
    expect(paths.some((path) => /^[a-z]:/i.test(path))).toBe(false);
    // The inner path of a placeholder is still a path the rule talks about.
    expect(paths).toContain('src/App.tsx');
  });

  it('3. reads npm scripts but not npm’s own subcommands', () => {
    expect(referencedScripts('- Run `npm run lint` before `npm test` and `npm install` once')).toEqual(['lint', 'test']);
    expect(referencedScripts('- Use yarn typecheck in CI')).toEqual(['typecheck']);
  });
});

describe('Broken references', () => {
  it('4. reports a file the folder no longer has, and quotes the line', () => {
    const result = audit([
      doc('agents', ['# AGENTS.md', '- Wire PlayerHealth in `Assets/Features/Player/PlayerHealth.cs`'].join('\n')),
      cleanCursorDoc
    ]);

    const finding = result.findings.find((item) => item.kind === 'missing-file');
    expect(finding).toBeTruthy();
    expect(finding!.missing).toBe('Assets/Features/Player/PlayerHealth.cs');
    expect(finding!.file).toBe('AGENTS.md');
    expect(finding!.line).toBe(2);
    expect(finding!.evidence).toContain('PlayerHealth.cs');
    expect(finding!.severity).toBe('problem');
  });

  it('5. accepts a file that is there, by path or by name', () => {
    const byPath = audit([doc('agents', '- Keep `src/main.js` small')]);
    const byName = audit([doc('agents', '- Keep main.js small')], { paths: ['deep/nested/main.js'] });

    expect(kinds(byPath.findings)).not.toContain('missing-file');
    expect(kinds(byName.findings)).not.toContain('missing-file');
  });

  it('6. accepts a directory that exists', () => {
    const result = audit([doc('agents', '- Everything under `src/` belongs to the loop')], { paths: ['src/main.js'] });
    expect(kinds(result.findings)).not.toContain('missing-file');
  });

  it('7. reports a script the folder does not declare', () => {
    const result = audit([doc('agents', '- Run `npm run lint` before every commit')], { scripts: ['test', 'build'] });

    const finding = result.findings.find((item) => item.kind === 'missing-command');
    expect(finding).toBeTruthy();
    expect(finding!.missing).toBe('npm run lint');
    expect(finding!.context).toBe('not-declared');
  });

  it('8. says so differently when the folder has no package.json at all', () => {
    const result = audit([doc('agents', '- Run `npm run lint` before every commit')], { scripts: null });

    const finding = result.findings.find((item) => item.kind === 'missing-command');
    expect(finding).toBeTruthy();
    expect(finding!.context).toBe('no-package-json');
  });

  it('9. stays quiet when there is no folder to compare with, and admits it', () => {
    const result = audit([doc('agents', ['- Keep `Assets/PlayerHealth.cs` wired up', '- Run `npm run lint` here'].join('\n'))], { paths: null });

    expect(kinds(result.findings)).not.toContain('missing-file');
    // A folder that is not connected is not a folder without a package.json: neither claim is made.
    expect(kinds(result.findings)).not.toContain('missing-command');
    expect(result.compared.files).toBe(false);
    expect(result.compared.commands).toBe(false);
  });
});

describe('Duplicates', () => {
  it('10. reports the same instruction twice in one file, with both line numbers', () => {
    const repeated = '- Always verify file paths against the real folder before writing code';
    const result = audit([doc('agents', ['# AGENTS.md', repeated, '- Something else entirely, a different rule', repeated].join('\n'))]);

    const finding = result.findings.find((item) => item.kind === 'duplicate-line');
    expect(finding).toBeTruthy();
    expect(finding!.line).toBe(2);
    expect(finding!.againstLines).toEqual([4]);
  });

  it('11. does not count a short line repeating as a duplicate', () => {
    const result = audit([doc('agents', ['# AGENTS.md', '- Tests', '- Tests'].join('\n'))]);
    expect(kinds(result.findings)).not.toContain('duplicate-line');
  });

  it('12. calls the same sentence in two files a note, because that is how two tools drift apart', () => {
    const shared = '- Keep every generated file inside the connected project folder';
    const result = audit([doc('agents', ['# AGENTS.md', shared].join('\n')), doc('claude', ['# CLAUDE.md', shared].join('\n'))]);

    const finding = result.findings.find((item) => item.kind === 'duplicate-across-files');
    expect(finding).toBeTruthy();
    expect(finding!.severity).toBe('note');
    expect(finding!.file).toBe('CLAUDE.md');
    expect(finding!.against).toBe('AGENTS.md');
  });
});

describe('Contradictions', () => {
  it('13. reports two rules about the same subject with opposite polarity', () => {
    const result = audit([
      doc('agents', ['# AGENTS.md', '- Использовать get_node() в скриптах', '- Никогда не использовать get_node() в скриптах'].join('\n'))
    ]);

    const finding = result.findings.find((item) => item.kind === 'contradiction');
    expect(finding).toBeTruthy();
    expect(finding!.severity).toBe('problem');
    expect(finding!.against).toContain('Использовать get_node()');
  });

  it('14. does not invent a contradiction between different subjects', () => {
    const result = audit([
      doc('agents', ['# AGENTS.md', '- Always run the tests before a commit', '- Never commit secrets to the repository'].join('\n'))
    ]);

    expect(kinds(result.findings)).not.toContain('contradiction');
  });
});

describe('Format and emptiness', () => {
  it('15. reports a Cursor file without frontmatter, which Cursor would ignore', () => {
    const result = audit([doc('cursor', ['# Rules', '', '- Keep it pure'].join('\n'))]);
    expect(kinds(result.findings)).toContain('missing-frontmatter');
  });

  it('16. warns when a rule can never apply by itself', () => {
    const result = audit([
      doc('cursor', ['---', 'alwaysApply: false', '---', '', '- Keep it pure'].join('\n'))
    ]);

    const finding = result.findings.find((item) => item.kind === 'inactive-frontmatter');
    expect(finding).toBeTruthy();
    expect(finding!.severity).toBe('note');
  });

  it('17. accepts a Cursor file that always applies', () => {
    const result = audit([cleanCursorDoc]);
    expect(kinds(result.findings)).not.toContain('missing-frontmatter');
    expect(kinds(result.findings)).not.toContain('inactive-frontmatter');
  });

  it('18. reports a rules file with no instructions in it at all', () => {
    const result = audit([doc('agents', '# AGENTS.md'), cleanCursorDoc]);

    const finding = result.findings.find((item) => item.kind === 'empty-document');
    expect(finding).toBeTruthy();
    expect(finding!.file).toBe('AGENTS.md');
  });

  it('19. counts problems and notes for the screen to show', () => {
    const result = audit([
      doc('agents', ['# AGENTS.md', '- Wire `Assets/Gone.cs` here', '- Wire `Assets/Gone.cs` here'].join('\n'))
    ]);

    expect(result.problems).toBe(result.findings.filter((item) => item.severity === 'problem').length);
    expect(result.notes).toBe(result.findings.filter((item) => item.severity === 'note').length);
    expect(result.problems).toBeGreaterThan(0);
  });

  it('20. finds nothing to say about rules that match the folder', () => {
    const result = audit([
      doc('agents', ['# AGENTS.md', '- Keep `src/main.js` small', '- Run `npm run test` before a commit'].join('\n')),
      cleanCursorDoc
    ]);

    expect(result.findings).toEqual([]);
    expect(result.problems).toBe(0);
  });
});

describe('Fixing what is safe to fix', () => {
  const projectName = 'Island Survival';

  it('21. drops the repeated line, keeps the first one, and leaves the rest alone', () => {
    const repeated = '- Always verify file paths against the real folder before writing code';
    const documents = [doc('agents', ['# AGENTS.md', repeated, '- Keep the loop tight', repeated].join('\n'))];
    const { findings } = audit(documents);

    const fixed = fixRuleDocuments(documents, findings, projectName);

    expect(fixed.removedDuplicates).toBe(1);
    expect(fixed.files[0].content.match(/Always verify file paths/g)).toHaveLength(1);
    expect(fixed.files[0].content).toContain('- Keep the loop tight');
  });

  it('22. drops a line that points at a file the folder no longer has', () => {
    const documents = [
      doc('agents', ['# AGENTS.md', '- Wire `Assets/Gone.cs` up', '- Keep `src/main.js` small'].join('\n'))
    ];
    const { findings } = audit(documents);

    const fixed = fixRuleDocuments(documents, findings, projectName);

    expect(fixed.removedBrokenReferences).toBe(1);
    expect(fixed.files[0].content).not.toContain('Assets/Gone.cs');
    expect(fixed.files[0].content).toContain('src/main.js');
  });

  it('23. gives the Cursor file the frontmatter it was missing', () => {
    const documents = [doc('cursor', ['# Rules', '', '- Keep it pure'].join('\n'))];
    const { findings } = audit(documents);

    const fixed = fixRuleDocuments(documents, findings, projectName);

    expect(fixed.addedFrontmatter).toBe(1);
    expect(fixed.files[0].content.startsWith('---\n')).toBe(true);
    expect(fixed.files[0].content).toContain(`description: Project rules for ${projectName}`);
    expect(fixed.files[0].content).toContain('- Keep it pure');
  });

  it('24. never touches a contradiction — which side is right is the author’s call', () => {
    const documents = [
      doc('agents', ['# AGENTS.md', '- Использовать get_node() в скриптах', '- Никогда не использовать get_node() в скриптах'].join('\n'))
    ];
    const { findings } = audit(documents);
    expect(kinds(findings)).toContain('contradiction');

    const fixed = fixRuleDocuments(documents, findings, projectName);

    expect(fixed.removedDuplicates).toBe(0);
    expect(fixed.removedBrokenReferences).toBe(0);
    expect(fixed.files[0].content).toContain('Использовать get_node()');
    expect(fixed.files[0].content).toContain('Никогда не использовать get_node()');
  });

  it('25. is done after one pass: fixing again changes nothing', () => {
    const documents = [
      doc('agents', ['# AGENTS.md', '- Wire `Assets/Gone.cs` up', '- Keep the loop tight', '- Keep the loop tight'].join('\n')),
      doc('cursor', ['# Rules', '', '- Keep it pure'].join('\n'))
    ];

    const first = fixRuleDocuments(documents, audit(documents).findings, projectName);
    const second = fixRuleDocuments(first.files, audit(first.files).findings, projectName);

    expect(second.removedDuplicates).toBe(0);
    expect(second.removedBrokenReferences).toBe(0);
    expect(second.addedFrontmatter).toBe(0);
    expect(second.files.map((file) => file.content)).toEqual(first.files.map((file) => file.content));
    expect(audit(first.files).findings).toEqual([]);
  });

  it('26. leaves an untouched file byte for byte as it was', () => {
    const documents = [
      doc('agents', ['# AGENTS.md', '- Keep `src/main.js` small'].join('\n')),
      doc('claude', ['# CLAUDE.md', '', '@AGENTS.md'].join('\n')),
      cleanCursorDoc
    ];

    const fixed = fixRuleDocuments(documents, audit(documents).findings, projectName);

    expect(fixed.files.map((file) => file.content)).toEqual(documents.map((file) => file.content));
  });
});
