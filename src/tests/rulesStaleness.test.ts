import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { bindWorkspace, resetWorkspaceStoreForTests, unbindWorkspace } from '../../server/store/workspaceStore';
import {
  checkRulesAgainstFolder,
  describeFinding,
  renderRulesSection,
  rulesSectionTitle
} from '../../server/utils/rulesStaleness';
import { compilePrompt } from '../../server/controllers/prompt.controller';
import { resetApiKeyStoreForTests } from '../../server/store/apiKeyStore';
import type { RulesContent } from '../../src/utils/rulesFiles';
import { formatRulesCheckTime } from '../../src/utils/rulesCheckStamp';

/**
 * The compiled prompt is what the user pastes into their agent, so it is the artifact these tests
 * pin: a rule that names a file the folder no longer has, or a script package.json never declared,
 * has to reach the agent as a warning instead of as an instruction to be followed.
 *
 * The folder is a real temporary folder and the check runs against it, because the only thing worth
 * proving here is that the sentences in the prompt are about files that really are (or are not)
 * there.
 */

let sandbox: string;
let projectRoot: string;

const ENV_VARS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NVIDIA_API_KEY'] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-rules-'));
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
});

beforeEach(() => {
  resetWorkspaceStoreForTests();
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'project-'));
  write('src/main.js', 'export const main = 1;\n');
  write('package.json', JSON.stringify({ name: 'demo', scripts: { test: 'vitest run', build: 'tsc -b' } }));
  bindWorkspace(projectRoot);

  // No provider keys, so the offline template is what answers — that template is the one the app
  // promises to build without any model at all.
  for (const name of ENV_VARS) {
    originalEnv[name] = process.env[name];
    delete process.env[name];
  }
  process.env.EPC_API_KEYS_FILE = path.join(sandbox, 'api-keys.json');
  resetApiKeyStoreForTests();
});

afterEach(() => {
  unbindWorkspace();
  fs.rmSync(projectRoot, { recursive: true, force: true });
  for (const name of ENV_VARS) {
    if (originalEnv[name] === undefined) delete process.env[name];
    else process.env[name] = originalEnv[name];
  }
  delete process.env.EPC_API_KEYS_FILE;
});

function write(relativePath: string, content: string): void {
  const target = path.join(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}

function rules(overrides: Partial<RulesContent> = {}): RulesContent {
  return {
    agentsMd: '# AGENTS.md\n\n- Wire `Assets/Gone.cs` into the spawn loop\n',
    claudeMd: '# CLAUDE.md — указатель\n\n@AGENTS.md\n',
    cursorRules: '---\ndescription: Project rules\nalwaysApply: true\n---\n\n# Rules\n\n- Keep the grid pure\n',
    ...overrides
  };
}

/** Calls the compiler straight, so the offline branch is what answers. */
async function compileOffline(body: Record<string, unknown>) {
  let payload: any = null;
  const res: any = {
    json: (data: any) => {
      payload = data;
      return res;
    },
    status: () => res
  };
  const req: any = {
    body: {
      language: 'ru',
      userRequest: 'Добавить механику голода',
      taskTitle: 'Добавить механику голода',
      projectMap: { projectName: 'Island Survival', projectType: 'Phaser.js', engineOrFramework: 'Phaser 3', language: 'JavaScript', files: [] },
      agent: 'DeepSeek / Web Chat',
      contextMode: 'Balanced',
      ...body
    }
  };
  await compilePrompt(req, res);
  return payload?.data;
}

describe('The rules check that feeds the compiler', () => {
  it('1. names the dead reference with its file and line', () => {
    const outcome = checkRulesAgainstFolder(rules(), 'Island Survival');
    expect(outcome).toBeTruthy();

    const section = renderRulesSection(outcome!, true);
    expect(section).toContain(rulesSectionTitle(true));
    expect(section).toContain('AGENTS.md:3');
    expect(section).toContain('Assets/Gone.cs');
    expect(section).toContain('Не считайте, что этот файл существует');
    // The folder was really read: its file count is in the sentence above the list.
    expect(section).toContain('файлов: 2');
  });

  it('2. reports a script the folder does not declare, and keeps quiet about the one it does', () => {
    const outcome = checkRulesAgainstFolder(
      rules({ agentsMd: '# AGENTS.md\n\n- Run `npm run lint` before a commit\n- Run `npm run test` after it\n' }),
      'Island Survival'
    );

    const section = renderRulesSection(outcome!, true);
    expect(section).toContain('npm run lint');
    expect(section).toContain('не объявлена в package.json');
    expect(section).not.toContain('npm run test —');
  });

  it('3. reports a contradiction between two rules, in either language', () => {
    const outcome = checkRulesAgainstFolder(
      rules({
        agentsMd: '# AGENTS.md\n\n- Использовать get_node() в скриптах\n- Никогда не использовать get_node() в скриптах\n'
      }),
      'Island Survival'
    );

    const contradiction = outcome!.audit.findings.find((finding) => finding.kind === 'contradiction');
    expect(contradiction).toBeTruthy();
    const line = describeFinding(contradiction!, true);
    expect(line).toContain('противоречие');
    expect(line).toContain('Никогда не использовать get_node()');
    expect(line).toContain('Использовать get_node()');
    expect(line).toContain('Не выбирайте сторону молча');
  });

  it('4. says the rules are sound when they are, instead of staying silent', () => {
    const outcome = checkRulesAgainstFolder(
      rules({ agentsMd: '# AGENTS.md\n\n- Keep `src/main.js` small\n- Run `npm run test` before a commit\n' }),
      'Island Survival'
    );

    expect(outcome!.audit.findings).toEqual([]);
    const section = renderRulesSection(outcome!, true);
    expect(section).toContain('Расхождений нет');
    expect(section).toContain('Следуйте им как есть');
  });

  it('5. admits what it could not compare when no folder is connected', () => {
    unbindWorkspace();

    const outcome = checkRulesAgainstFolder(rules(), 'Island Survival');
    expect(outcome!.audit.compared.files).toBe(false);
    expect(outcome!.audit.findings.map((finding) => finding.kind)).not.toContain('missing-file');

    const section = renderRulesSection(outcome!, true);
    expect(section).toContain('Папка проекта не подключена');
    // Not the "no package.json" claim: nobody looked at any folder.
    expect(section).not.toContain('не объявлена в package.json');
  });

  it('6. reads the same findings in English', () => {
    const outcome = checkRulesAgainstFolder(rules(), 'Island Survival');
    const section = renderRulesSection(outcome!, false);

    expect(section).toContain(rulesSectionTitle(false));
    expect(section).toContain('does not have');
    expect(section).toContain('AGENTS.md:3');
    expect(/[а-яА-Я]/.test(section)).toBe(false);
  });

  it('7. dates the check, so the facts in the prompt are not of unknown age', () => {
    const checkedAt = new Date('2026-10-16T11:32:00.000Z');
    const outcome = checkRulesAgainstFolder(rules(), 'Island Survival', checkedAt);

    expect(outcome!.checkedAt).toBe(checkedAt.toISOString());

    const ru = renderRulesSection(outcome!, true);
    expect(ru).toContain(`сверка: ${formatRulesCheckTime(checkedAt.toISOString())}`);

    const en = renderRulesSection(outcome!, false);
    expect(en).toContain(`checked at: ${formatRulesCheckTime(checkedAt.toISOString())}`);
  });
});

describe('The compiled prompt carries the check', () => {
  it('8. puts the stale lines into the prompt, before the task', async () => {
    const data = await compileOffline({ rules: rules(), projectName: 'Island Survival' });

    expect(data.rulesCheck.audit.problems).toBeGreaterThan(0);
    expect(data.promptText).toContain(rulesSectionTitle(true));
    expect(data.promptText).toContain('Assets/Gone.cs');
    // The prompt says when the folder was read, so nobody has to guess how old its facts are.
    expect(data.promptText).toContain(`сверка: ${formatRulesCheckTime(data.rulesCheck.checkedAt)}`);
    // What the agent must not do is read before what it is asked to do.
    expect(data.promptText.indexOf(rulesSectionTitle(true))).toBeLessThan(data.promptText.indexOf('## Задача'));
  });

  it('9. tells the agent the rules are sound when nothing is stale', async () => {
    const data = await compileOffline({
      rules: rules({ agentsMd: '# AGENTS.md\n\n- Keep `src/main.js` small\n' }),
      projectName: 'Island Survival'
    });

    expect(data.rulesCheck.audit.problems).toBe(0);
    expect(data.promptText).toContain('Расхождений нет');
  });

  it('10. says nothing was compared when there is no folder', async () => {
    unbindWorkspace();

    const data = await compileOffline({ rules: rules(), projectName: 'Island Survival' });

    expect(data.promptText).toContain('Папка проекта не подключена');
    expect(data.rulesCheck.audit.compared.files).toBe(false);
  });

  it('11. carries nothing at all when the project has no rules', async () => {
    const data = await compileOffline({ projectName: 'Island Survival' });

    expect(data.rulesCheck).toBeNull();
    expect(data.promptText).not.toContain(rulesSectionTitle(true));
  });

  it('12. keeps the check out of the way of the rest of the prompt', async () => {
    const data = await compileOffline({ rules: rules(), projectName: 'Island Survival' });

    // The section is one block, not a rewrite of the prompt: everything the compiler promises is
    // still there.
    expect(data.promptText).toContain('## Критерии приемки');
    expect(data.promptText).toContain('## Формат вывода');
    expect(data.promptText.match(new RegExp(rulesSectionTitle(true).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))).toHaveLength(1);
  });
});

describe('Nothing here is invented', () => {
  it('13. never reads the folder for a folder that is not there', () => {
    unbindWorkspace();
    const spy = vi.spyOn(fs, 'readdirSync');

    checkRulesAgainstFolder(rules(), 'Island Survival');

    // No walk, no package.json read: an unconnected workspace is not scanned at all.
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
