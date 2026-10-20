import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { bindWorkspace, resetWorkspaceStoreForTests } from '../../server/store/workspaceStore';
import { planTaskContext, describePlan } from '../../server/services/contextPlan';

/**
 * The plan against a real folder — because the point of the feature is what the model sees, and
 * what it sees is decided by files on disk, not by a fixture object.
 *
 * These pin the four reasons a file can enter the prompt, the budget that stops the tail, the
 * seed that does not exist yet, and the path list that must lead with the task instead of the
 * alphabet.
 */

let sandbox: string;
let projectRoot: string;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-context-'));
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
  process.env.EPC_WORKSPACE_BACKUP_DIR = path.join(sandbox, 'backups');
});

beforeEach(() => {
  resetWorkspaceStoreForTests();
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'project-'));
  bindWorkspace(projectRoot);
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
  const absolute = path.join(projectRoot, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
}

/** A small TypeScript project: types <- service <- screen, plus a test and an unrelated folder. */
function seedProject(): void {
  write('src/types.ts', 'export interface User { id: string }\n');
  write('src/service.ts', "import { User } from './types';\nexport const findUser = (id: string): User => ({ id });\n");
  write('src/screen.tsx', "import { findUser } from './service';\nexport const Screen = () => findUser('1');\n");
  write('src/service.test.ts', "import { findUser } from './service';\nfetchUser();\n");
  write('docs/notes.md', '# notes\n');
}

describe('planTaskContext', () => {
  it('brings the type a service imports without the task naming it', () => {
    seedProject();

    const plan = planTaskContext({ seeds: ['src/service.ts'] });

    expect(plan.entries.map((entry) => `${entry.path}:${entry.reason}`)).toContain('src/types.ts:import');
    expect(plan.blocks).toContain('### FILE: src/types.ts');
    expect(plan.blocks).toContain('export interface User');
  });

  it('shows what imports the seed, and its test, in that order', () => {
    seedProject();

    const plan = planTaskContext({ seeds: ['src/service.ts'] });
    const order = plan.entries.map((entry) => entry.path);
    const screen = order.indexOf('src/screen.tsx');
    const test = order.indexOf('src/service.test.ts');

    expect(plan.entries.find((entry) => entry.path === 'src/screen.tsx')?.reason).toBe('importer');
    expect(plan.entries.find((entry) => entry.path === 'src/service.test.ts')?.reason).toBe('test');
    expect(screen).toBeGreaterThan(-1);
    expect(test).toBeGreaterThan(screen);
  });

  it('adds a neighbour that names the seed symbol without importing it', () => {
    write('Assets/PlayerHealth.cs', 'public class PlayerHealth {}\n');
    write('Assets/Hud.cs', 'class Hud { void Draw() { var hp = PlayerHealth.Instance; } }\n');
    write('Assets/Unrelated.cs', 'class Unrelated {}\n');

    const plan = planTaskContext({ seeds: ['Assets/PlayerHealth.cs'] });

    expect(plan.entries.find((entry) => entry.path === 'Assets/Hud.cs')?.reason).toBe('mention');
    expect(plan.entries.some((entry) => entry.path === 'Assets/Unrelated.cs')).toBe(false);
  });

  it('crops the graph by budget instead of sending the whole folder', () => {
    for (let i = 0; i < 6; i += 1) write(`src/m${i}.ts`, `import './m${(i + 1) % 6}';\n${'x'.repeat(4000)}`);
    write('src/seed.ts', "import './m0';\n");

    const plan = planTaskContext({ seeds: ['src/seed.ts'], budgetChars: 1000 });

    expect(plan.entries.length).toBeGreaterThan(0);
    const spent = plan.entries.reduce((sum, entry) => sum + entry.chars, 0);
    expect(spent).toBeLessThanOrEqual(1000 + 4000); // the seed itself is never dropped
    expect(plan.blocks.length).toBeLessThan(10_000);
  });

  it('leads the path list with the task, not with the alphabet', () => {
    write('aaa/unrelated.ts', 'export const nothing = 1;\n');
    write('zzz/service.ts', 'export const service = 1;\n');

    const plan = planTaskContext({ seeds: ['zzz/service.ts'] });

    expect(plan.indexPath[0]).toBe('zzz/service.ts');
    expect(plan.indexPath).toContain('aaa/unrelated.ts');
    expect(plan.indexPath.indexOf('zzz/service.ts')).toBeLessThan(plan.indexPath.indexOf('aaa/unrelated.ts'));
  });

  it('names a seed that does not exist yet without inventing content for it', () => {
    seedProject();

    const plan = planTaskContext({ seeds: ['src/new/Thing.ts'] });

    expect(plan.entries[0]).toMatchObject({ path: 'src/new/Thing.ts', reason: 'seed', chars: 0 });
    expect(plan.blocks).not.toContain('### FILE: src/new/Thing.ts');
  });

  it('refuses a seed outside the folder instead of putting it in the prompt', () => {
    seedProject();

    const plan = planTaskContext({ seeds: ['../../etc/passwd', 'src/service.ts'] });

    expect(plan.entries[0]).toMatchObject({ path: 'src/service.ts', reason: 'seed' });
    expect(plan.entries.map((entry) => entry.path)).not.toContain('../../etc/passwd');
    expect(plan.indexPath.join('\n')).not.toContain('passwd');
  });

  it('gives the same plan twice in a row', () => {
    seedProject();

    expect(planTaskContext({ seeds: ['src/service.ts'] }).entries).toEqual(
      planTaskContext({ seeds: ['src/service.ts'] }).entries
    );
  });

  it('describes itself in one line, for a log rather than a paragraph', () => {
    seedProject();

    expect(describePlan(planTaskContext({ seeds: ['src/service.ts'] }))).toBe(
      '4 files (seed:1 import:1 importer:1 test:1)'
    );
  });
});
