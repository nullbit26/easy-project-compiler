import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { bindWorkspace, resetWorkspaceStoreForTests } from '../../server/store/workspaceStore';

/**
 * The feature only matters if the prompt actually changes. The loop's own test file stubs the
 * workspace away, so this one uses a real folder: the task names `service.ts`, and the type file
 * it imports has to reach the model without being named anywhere.
 */

let sandbox: string;
let projectRoot: string;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-autopilot-context-'));
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
  process.env.EPC_WORKSPACE_BACKUP_DIR = path.join(sandbox, 'backups');
  process.env.EPC_WEIGHT_FILE = path.join(sandbox, 'weight.json');
});

beforeEach(() => {
  resetWorkspaceStoreForTests();
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'project-'));
  bindWorkspace(projectRoot);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
  const absolute = path.join(projectRoot, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
}

describe('The autonomous prompt', () => {
  it('carries the imported type file even though the task never named it', async () => {
    write('src/types.ts', 'export interface User { id: string }\n');
    write('src/service.ts', "import { User } from './types';\nexport const findUser = (id: string): User => ({ id });\n");
    write('src/screen.tsx', "import { findUser } from './service';\nexport const Screen = () => findUser('1');\n");
    write('aaa/unrelated.ts', 'export const nothing = 1;\n');

    const ai = await import('../../server/ai/aiProvider');
    const checks = await import('../../server/services/projectChecks');
    let prompt = '';

    vi.spyOn(ai, 'hasAiProvider').mockReturnValue(true);
    vi.spyOn(ai, 'getEngineLabel').mockReturnValue('test-engine');
    vi.spyOn(ai, 'callAiJson').mockImplementation(async (text: string) => {
      prompt = text;
      return {
        summary: 'ok',
        changes: [
          {
            path: 'src/service.ts',
            action: 'update',
            content: "import { User } from './types';\nexport const findUser = (id: string): User => ({ id });\n",
            reason: 'keep'
          }
        ]
      };
    });
    vi.spyOn(checks, 'runVerification').mockImplementation(async () => ({
      ranAt: 'now',
      ok: true,
      passed: 1,
      failed: 0,
      problems: [],
      results: [
        {
          id: 'check:1',
          kind: 'typecheck',
          key: 'tsc',
          labelRu: 'Типы',
          labelEn: 'Types',
          commandLine: 'tsc --noEmit',
          status: 'passed',
          exitCode: 0,
          durationMs: 1,
          problems: [],
          output: '',
          outputTruncated: false,
          tokens: []
        }
      ]
    } as any));

    const { runAutonomousTask } = await import('../../server/services/autonomousLoop');
    const result = await runAutonomousTask({
      taskTitle: 'Keep findUser working',
      targetFiles: ['src/service.ts'],
      ru: false
    });

    expect(result.status).toBe('completed');
    // The seed, its import, and its importer — none of the last two were named by the task.
    expect(prompt).toContain('### FILE: src/service.ts');
    expect(prompt).toContain('### FILE: src/types.ts');
    expect(prompt).toContain('### FILE: src/screen.tsx');
    // An unrelated file in an alphabetically earlier folder is not context.
    expect(prompt).not.toContain('### FILE: aaa/unrelated.ts');
    // The path list leads with the task, so a model with a short attention span still sees it.
    const index = prompt.slice(prompt.indexOf('FILES IN THE FOLDER'));
    expect(index.indexOf('src/service.ts')).toBeLessThan(index.indexOf('aaa/unrelated.ts'));
  });

  it('gives a repair attempt the files it is being asked to repair', async () => {
    write('src/types.ts', 'export interface User { id: string }\n');
    write('src/service.ts', "import { User } from './types';\nexport const findUser = (id: string): User => ({ id });\n");

    const ai = await import('../../server/ai/aiProvider');
    const checks = await import('../../server/services/projectChecks');
    const prompts: string[] = [];

    vi.spyOn(ai, 'hasAiProvider').mockReturnValue(true);
    vi.spyOn(ai, 'getEngineLabel').mockReturnValue('test-engine');
    vi.spyOn(ai, 'callAiJson').mockImplementation(async (text: string) => {
      prompts.push(text);
      return {
        summary: 'attempt',
        changes: [
          {
            path: 'src/service.ts',
            action: 'update',
            content: "import { User } from './types';\nexport const findUser = (id: string): User => ({ id });\n",
            reason: 'keep'
          }
        ]
      };
    });
    vi.spyOn(checks, 'runVerification').mockImplementation(async () => ({
      ranAt: 'now',
      ok: false,
      passed: 0,
      failed: 1,
      problems: [],
      results: [
        {
          id: 'check:1',
          kind: 'typecheck',
          key: 'tsc',
          labelRu: 'Типы',
          labelEn: 'Types',
          commandLine: 'tsc --noEmit',
          status: 'failed',
          exitCode: 2,
          durationMs: 1,
          problems: [{ file: 'src/service.ts', line: 2, raw: 'error TS9999: broken' }],
          output: 'error TS9999: broken',
          outputTruncated: false,
          tokens: []
        }
      ]
    } as any));

    const { runAutonomousTask } = await import('../../server/services/autonomousLoop');
    const result = await runAutonomousTask({
      taskTitle: 'Keep findUser working',
      targetFiles: ['src/service.ts'],
      ru: false
    });

    expect(result.status).toBe('failed');
    expect(prompts).toHaveLength(4);
    // The repair prompt used to carry only the failure: the model answered «no changes» twice.
    expect(prompts[1]).toContain('WHAT THE CHECKS SAID');
    expect(prompts[1]).toContain('### FILE: src/types.ts');
    expect(prompts[1]).toContain('the failed batch was undone');
  });
});
