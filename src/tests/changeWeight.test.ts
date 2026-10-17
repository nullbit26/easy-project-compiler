import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { bindWorkspace, resetWorkspaceStoreForTests } from '../../server/store/workspaceStore';
import { applyFileChanges } from '../../server/services/workspaceFiles';
import {
  findBuildDir,
  measureBuildWeight,
  measureDirectory,
  measureProject,
  measureWriteWeight,
  percentChange
} from '../../server/services/changeWeight';
import { getWeightBaselinePath, readWeightBaseline } from '../../server/store/weightBaseline';

/**
 * "The checks still pass" says nothing about the bill. These tests pin down what the weight
 * feature is allowed to claim: the size of a batch counted from its own undo copies, the size of
 * the project compared with the last write, the size of a build that really ran — and, when a
 * number cannot be trusted, that it says so instead of guessing.
 */

let sandbox: string;
let projectRoot: string;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-weight-'));
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
  process.env.EPC_WORKSPACE_BACKUP_DIR = path.join(sandbox, 'backups');
  process.env.EPC_WEIGHT_FILE = path.join(sandbox, 'weight.json');
});

beforeEach(() => {
  resetWorkspaceStoreForTests();
  try {
    fs.rmSync(getWeightBaselinePath(), { force: true });
  } catch {
    // A missing history is the normal starting point.
  }
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'project-'));
  bindWorkspace(projectRoot);
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function write(relative: string, content: string | Buffer): number {
  const absolute = path.join(projectRoot, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
  return Buffer.byteLength(content as any);
}

/** A batch written the way the app writes one, so the sizes are the app's own. */
function apply(changes: Array<Record<string, unknown>>) {
  return applyFileChanges(changes);
}

describe('How heavy the change was', () => {
  it('1. counts the project’s own files, leaving dependencies and build output out', () => {
    const appBytes = write('src/app.js', 'a'.repeat(1000));
    const packageBytes = write('package.json', '{}\n');
    write('node_modules/dep/index.js', 'b'.repeat(5000));
    write('dist/bundle.js', 'c'.repeat(7000));

    const measured = measureProject();

    expect(measured.bytes).toBe(appBytes + packageBytes);
    expect(measured.fileCount).toBe(2);
    expect(measured.truncated).toBe(false);
  });

  it('2. weighs a batch exactly, from the undo copies through to disk', () => {
    write('src/keep.js', 'a'.repeat(100));
    write('src/shrink.js', 'b'.repeat(500));
    write('src/gone.js', 'c'.repeat(40));

    const applied = apply([
      { path: 'src/keep.js', content: 'a'.repeat(1000) },
      { path: 'src/new.js', content: 'd'.repeat(300) },
      { path: 'src/shrink.js', content: 'b'.repeat(200) },
      { path: 'src/gone.js', action: 'delete' }
    ]);

    // The write itself already knows what each file weighed; the weight is built from that.
    const byPath = Object.fromEntries(applied.results.map((entry) => [entry.path, entry]));
    expect(byPath['src/keep.js'].previousBytes).toBe(100);
    expect(byPath['src/new.js'].previousBytes).toBe(0);
    expect(byPath['src/gone.js'].sizeBytes).toBe(0);

    return measureWriteWeight({ changesetId: applied.backupId, changes: applied.results }).then((weight) => {
      expect(weight.files).toBe(4);
      expect(weight.beforeBytes).toBe(640);
      expect(weight.afterBytes).toBe(1500);
      expect(weight.netBytes).toBe(860);
      expect(weight.heaviest).toEqual({ path: 'src/keep.js', deltaBytes: 900, afterBytes: 1000 });
    });
  });

  it('3. says “nothing to compare with” at first, then compares against the last write', async () => {
    write('src/app.js', 'a'.repeat(400));

    const first = await measureWriteWeight({
      changesetId: 'cs-1',
      changes: apply([{ path: 'src/app.js', content: 'a'.repeat(400) }]).results
    });
    expect(first.projectDeltaBytes).toBeNull();
    expect(first.projectDeltaPct).toBeNull();
    expect(first.note).toBe('first_measurement');
    expect(first.heavy).toBe(false);

    // A file changed by hand, not by the app: it moves the total and is named as not-ours.
    write('src/hand.js', 'h'.repeat(2048));

    const second = await measureWriteWeight({ changesetId: 'cs-2', changes: [] });
    expect(second.projectDeltaBytes).toBe(2048);
    expect(second.otherBytes).toBe(2048);
    expect(second.note).toBeUndefined();
  });

  it('4. points out a write that made the project noticeably heavier', async () => {
    write('src/app.js', 'a'.repeat(1000));
    await measureWriteWeight({
      changesetId: 'cs-0',
      changes: apply([{ path: 'src/app.js', content: 'a'.repeat(1000) }]).results
    });

    const weight = await measureWriteWeight({
      changesetId: 'cs-1',
      changes: apply([{ path: 'src/heavy.js', content: 'h'.repeat(40_000) }]).results
    });

    expect(weight.netBytes).toBe(40_000);
    expect(weight.projectDeltaBytes).toBe(40_000);
    expect(weight.projectDeltaPct).toBe(4000);
    expect(weight.heavy).toBe(true);
    expect(weight.heaviest?.path).toBe('src/heavy.js');
  });

  it('4b. calls a heavy first write heavy without claiming the project changed', async () => {
    write('src/app.js', 'a'.repeat(500));

    const weight = await measureWriteWeight({
      changesetId: 'cs-1',
      changes: apply([{ path: 'src/new.js', content: 'n'.repeat(50_000) }]).results
    });

    // Only the batch is known here, so the project delta stays honestly empty.
    expect(weight.note).toBe('first_measurement');
    expect(weight.projectDeltaBytes).toBeNull();
    expect(weight.heavy).toBe(true);
  });

  it('4c. does not treat a build measurement as a project measurement', async () => {
    write('src/app.js', 'a'.repeat(300));
    write('dist/bundle.js', 'b'.repeat(1000));

    // A build was measured first, so the folder has a history — but not a history of the project.
    await measureBuildWeight({ changesetId: 'cs-build' });

    const weight = await measureWriteWeight({
      changesetId: 'cs-1',
      changes: apply([{ path: 'src/app.js', content: 'a'.repeat(900) }]).results
    });

    expect(weight.note).toBe('first_measurement');
    expect(weight.projectDeltaBytes).toBeNull();
    expect(weight.heavy).toBe(false);
  });

  it('5. measures build output only when something was really built', async () => {
    expect(findBuildDir(projectRoot)).toBeNull();
    expect(await measureBuildWeight({ changesetId: null })).toBeNull();

    // An existing but empty folder is not a build output either.
    fs.mkdirSync(path.join(projectRoot, 'dist'), { recursive: true });
    expect(await measureBuildWeight({ changesetId: null })).toBeNull();

    write('dist/bundle.js', 'b'.repeat(1200));
    write('dist/style.css', 'c'.repeat(300));

    const first = await measureBuildWeight({ changesetId: 'cs-1' });
    expect(first).toMatchObject({ dir: 'dist', bytes: 1500, fileCount: 2, note: 'first_measurement' });
    expect(first?.deltaBytes).toBeNull();
    expect(first?.heavy).toBe(false);

    // A bigger build is compared with the previous one, and a big jump is called out.
    write('dist/bundle.js', 'b'.repeat(30_000));
    const second = await measureBuildWeight({ changesetId: 'cs-2' });
    expect(second?.deltaBytes).toBe(30_000 - 1200);
    expect(second?.note).toBeUndefined();
    expect(second?.heavy).toBe(true);
  });

  it('6. keeps the build numbers when a write refreshes the project numbers', async () => {
    write('src/app.js', 'a'.repeat(500));
    write('dist/bundle.js', 'b'.repeat(1000));
    await measureBuildWeight({ changesetId: 'cs-build' });

    const applied = apply([{ path: 'src/app.js', content: 'a'.repeat(2000) }]);
    await measureWriteWeight({ changesetId: applied.backupId, changes: applied.results });

    // The write measured the project (build output is not part of that number) and must not have
    // thrown the build measurement away.
    const stored = readWeightBaseline(projectRoot);
    expect(stored?.projectBytes).toBe(2000);
    expect(stored?.buildDir).toBe('dist');
    expect(stored?.buildBytes).toBe(1000);

    write('dist/bundle.js', 'b'.repeat(1500));
    const next = await measureBuildWeight({ changesetId: 'cs-build-2' });
    expect(next?.deltaBytes).toBe(500);
  });

  it('7. measures each folder on its own', async () => {
    write('src/app.js', 'a'.repeat(700));
    await measureWriteWeight({ changesetId: 'cs-a', changes: [] });

    const other = fs.mkdtempSync(path.join(sandbox, 'other-'));
    try {
      bindWorkspace(other);
      write('src/app.js', 'a'.repeat(700));

      const weight = await measureWriteWeight({ changesetId: 'cs-b', changes: [] });
      // A different folder has no history of its own, so it starts from "nothing to compare with".
      expect(weight.note).toBe('first_measurement');
      expect(weight.projectDeltaBytes).toBeNull();
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
      bindWorkspace(projectRoot);
    }
  });

  it('8. survives a damaged history file instead of failing a write over it', async () => {
    write('src/app.js', 'a'.repeat(300));
    fs.writeFileSync(getWeightBaselinePath(), '{ not json at all', 'utf8');

    const weight = await measureWriteWeight({
      changesetId: 'cs-1',
      changes: apply([{ path: 'src/app.js', content: 'a'.repeat(600) }]).results
    });

    expect(weight.netBytes).toBe(300);
    expect(weight.note).toBe('first_measurement');
    expect(readWeightBaseline(projectRoot)?.projectBytes).toBeGreaterThan(0);
  });

  it('9. counts a directory as it is on disk, and knows when it stopped counting', () => {
    write('dist/a.js', 'x'.repeat(100));
    write('dist/nested/b.js', 'y'.repeat(250));

    const measured = measureDirectory(path.join(projectRoot, 'dist'));
    expect(measured).toEqual({ bytes: 350, fileCount: 2, truncated: false });
  });

  it('10. turns two sizes into a percentage, and refuses to divide by nothing', () => {
    expect(percentChange(1000, 1500)).toBe(50);
    expect(percentChange(1000, 500)).toBe(-50);
    expect(percentChange(0, 5000)).toBeNull();
    expect(percentChange(1000, 1000)).toBe(0);
  });
});
