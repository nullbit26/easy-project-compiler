// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { bindWorkspace, resetWorkspaceStoreForTests } from '../../server/store/workspaceStore';
import {
  BudgetError,
  getBudgetPath,
  parseBudgetBytes,
  readWeightBudget,
  writeWeightBudget
} from '../../server/store/weightBudget';
import {
  evaluateBuildBudget,
  lastBuildBudgetVerdict,
  measureBuildWeight
} from '../../server/services/changeWeight';

/**
 * A number nobody judges is a report; the same number in front of a ceiling is a check. These
 * tests pin down what the budget is allowed to claim: it is one size the user wrote down, it is
 * judged only against a build that really ran, and \"there is no ceiling\" is never reported as
 * \"within budget\".
 */

let sandbox: string;
let projectRoot: string;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-budget-'));
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
  process.env.EPC_WORKSPACE_BACKUP_DIR = path.join(sandbox, 'backups');
  process.env.EPC_WEIGHT_FILE = path.join(sandbox, 'weight.json');
  process.env.EPC_BUDGET_FILE = path.join(sandbox, 'budget.json');
});

beforeEach(() => {
  resetWorkspaceStoreForTests();
  for (const file of [getBudgetPath(), process.env.EPC_WEIGHT_FILE!]) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // A missing file is the normal starting point.
    }
  }
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

describe('The weight budget', () => {
  it('1. reads a budget written the way a person writes one', () => {
    expect(parseBudgetBytes('500 KB')).toBe(512_000);
    expect(parseBudgetBytes('500kb')).toBe(512_000);
    expect(parseBudgetBytes('1.5 MB')).toBe(1_572_864);
    expect(parseBudgetBytes('1,5 мб')).toBe(1_572_864);
    expect(parseBudgetBytes('400000')).toBe(400_000);
    expect(parseBudgetBytes('2048 b')).toBe(2048);
    // An empty field is not an error: it is how a budget is removed.
    expect(parseBudgetBytes('')).toBeNull();
    expect(parseBudgetBytes('   ')).toBeNull();
    expect(parseBudgetBytes(null)).toBeNull();
    expect(parseBudgetBytes(undefined)).toBeNull();
  });

  it('2. refuses a budget it cannot read as a size, instead of guessing one', () => {
    for (const value of ['abc', '500 кг', '-5 KB', '0', '1 KB (примерно)', '10 MB ']) {
      // Trailing whitespace is trimmed, so only the ones that are not sizes are refused.
      const isSize = String(value).trim().toLowerCase().match(/^\d+(?:[.,]\d+)?\s*(b|kb|mb)?$/);
      if (isSize) continue;
      try {
        parseBudgetBytes(value);
        throw new Error(`"${value}" should have been refused`);
      } catch (err: any) {
        expect(err).toBeInstanceOf(BudgetError);
        expect(err.code).toBe('invalid_budget');
      }
    }
    // A size below a kilobyte is a typo, not a budget.
    expect(() => parseBudgetBytes('10 b')).toThrow(BudgetError);
    expect(() => parseBudgetBytes('9000 GB')).toThrow(BudgetError);
  });

  it('3. keeps one ceiling per folder, and forgets it when the field is emptied', () => {
    writeWeightBudget(projectRoot, 512_000);
    expect(readWeightBudget(projectRoot)).toMatchObject({ bytes: 512_000 });
    expect(readWeightBudget(projectRoot)?.setAt).toBeTruthy();

    const other = fs.mkdtempSync(path.join(sandbox, 'other-'));
    try {
      // A second folder has no ceiling of its own — the first one's is not borrowed.
      expect(readWeightBudget(other)).toBeNull();
      writeWeightBudget(other, 1024 * 1024);
      expect(readWeightBudget(other)?.bytes).toBe(1024 * 1024);
      expect(readWeightBudget(projectRoot)?.bytes).toBe(512_000);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }

    expect(writeWeightBudget(projectRoot, null)).toBeNull();
    expect(readWeightBudget(projectRoot)).toBeNull();
  });

  it('4. survives a damaged budget file instead of losing the folder', () => {
    fs.writeFileSync(getBudgetPath(), '{ not json', 'utf8');
    expect(readWeightBudget(projectRoot)).toBeNull();
    writeWeightBudget(projectRoot, 2048);
    expect(readWeightBudget(projectRoot)?.bytes).toBe(2048);
  });

  it('5. never says "within budget" when there is no budget', () => {
    expect(evaluateBuildBudget({ root: projectRoot, actual: 5_000_000 })).toEqual({
      bytes: null,
      actual: 5_000_000,
      over: null,
      deltaBytes: null,
      usedPct: null
    });

    writeWeightBudget(projectRoot, 512_000);
    expect(evaluateBuildBudget({ root: projectRoot, actual: 400_000 })).toEqual({
      bytes: 512_000,
      actual: 400_000,
      over: false,
      deltaBytes: -112_000,
      usedPct: 78.1
    });
    expect(evaluateBuildBudget({ root: projectRoot, actual: 1_024_000 })).toEqual({
      bytes: 512_000,
      actual: 1_024_000,
      over: true,
      deltaBytes: 512_000,
      usedPct: 200
    });
  });

  it('6. cannot judge a folder whose build was never measured here', async () => {
    write('src/app.js', 'a'.repeat(200));
    writeWeightBudget(projectRoot, 512_000);

    // Nothing has been built yet, so there is no number to put in front of the ceiling…
    expect(lastBuildBudgetVerdict(projectRoot)).toBeNull();
    // …and an existing but empty `dist/` is not a build either.
    fs.mkdirSync(path.join(projectRoot, 'dist'), { recursive: true });
    expect(await measureBuildWeight({ changesetId: null })).toBeNull();
    expect(lastBuildBudgetVerdict(projectRoot)).toBeNull();

    write('dist/bundle.js', 'b'.repeat(600_000));
    const build = await measureBuildWeight({ changesetId: 'cs-1' });
    // The verdict comes from the build that just ran, not from a number invented on the spot.
    expect(lastBuildBudgetVerdict(projectRoot)).toMatchObject({ bytes: 512_000, over: true });
    expect(build?.bytes).toBe(600_000);

    writeWeightBudget(projectRoot, 1024 * 1024);
    expect(lastBuildBudgetVerdict(projectRoot)).toMatchObject({ over: false, deltaBytes: -448_576 });
  });
});
