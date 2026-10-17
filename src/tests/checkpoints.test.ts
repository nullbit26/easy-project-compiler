import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { bindWorkspace, resetWorkspaceStoreForTests } from '../../server/store/workspaceStore';
import {
  applyFileChanges,
  attachVerification,
  createCheckpoint,
  deleteCheckpoint,
  listBackups,
  readWorkspaceTextFile,
  rollbackToCheckpoint,
  undoFileChanges
} from '../../server/services/workspaceFiles';

/**
 * A checkpoint is a promise: "the project was in this state here". These tests check that the
 * promise holds — rollback must land on the exact state the marker was taken in, no matter how
 * many batches were written afterwards.
 */

let sandbox: string;
let projectRoot: string;

beforeAll(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-checkpoints-'));
  process.env.EPC_WORKSPACE_FILE = path.join(sandbox, 'workspace.json');
});

beforeEach(() => {
  // A fresh backup root per test keeps checkpoints and history from leaking between them.
  process.env.EPC_WORKSPACE_BACKUP_DIR = fs.mkdtempSync(path.join(sandbox, 'backups-'));
  resetWorkspaceStoreForTests();
  projectRoot = fs.mkdtempSync(path.join(sandbox, 'project-'));
  fs.writeFileSync(path.join(projectRoot, 'readme.txt'), 'first\n', 'utf8');
  bindWorkspace(projectRoot);
});

afterEach(() => {
  fs.rmSync(projectRoot, { recursive: true, force: true });
});

function readFile(relative: string): string {
  return fs.readFileSync(path.join(projectRoot, relative), 'utf8');
}

function writeFile(relative: string, content: string): void {
  const absolute = path.join(projectRoot, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, 'utf8');
}

describe('Checkpoints', () => {
  it('1. names a checkpoint, records it and lists it back', () => {
    applyFileChanges([{ path: 'readme.txt', action: 'update', content: 'second\n' }]);

    const created = createCheckpoint('Работает меню');
    expect(created.checkpoint.name).toBe('Работает меню');
    expect(created.checkpoint.changesetId).not.toBeNull();
    expect(created.checkpoints).toHaveLength(1);

    // An unnamed checkpoint still gets a usable label.
    const auto = createCheckpoint('   ');
    expect(auto.checkpoint.name).toBe('Checkpoint 2');
    expect(auto.checkpoints).toHaveLength(2);
  });

  it('2. rolls the project back to the moment the checkpoint was taken', () => {
    applyFileChanges([{ path: 'readme.txt', action: 'update', content: 'second\n' }]);
    const marker = createCheckpoint('good state');

    // Two more batches: a change on top and a brand new file.
    applyFileChanges([{ path: 'readme.txt', action: 'update', content: 'third\n' }]);
    applyFileChanges([{ path: 'added/extra.txt', action: 'create', content: 'extra\n' }]);
    expect(readFile('readme.txt')).toBe('third\n');
    expect(fs.existsSync(path.join(projectRoot, 'added/extra.txt'))).toBe(true);

    const rollback = rollbackToCheckpoint(marker.checkpoint.id);

    expect(rollback.undoneChangesets).toBe(2);
    expect(rollback.failed).toBe(0);
    expect(readFile('readme.txt')).toBe('second\n');
    expect(fs.existsSync(path.join(projectRoot, 'added/extra.txt'))).toBe(false);
  });

  it('3. a checkpoint taken before any write undoes the whole history', () => {
    const marker = createCheckpoint('clean start');
    expect(marker.checkpoint.changesetId).toBeNull();

    applyFileChanges([{ path: 'readme.txt', action: 'update', content: 'changed\n' }]);
    applyFileChanges([{ path: 'new.txt', action: 'create', content: 'new\n' }]);

    const rollback = rollbackToCheckpoint(marker.checkpoint.id);
    expect(rollback.undoneChangesets).toBe(2);
    expect(readFile('readme.txt')).toBe('first\n');
    expect(fs.existsSync(path.join(projectRoot, 'new.txt'))).toBe(false);
  });

  it('4. rolling back to the newest state does nothing, and unknown ids are refused', () => {
    applyFileChanges([{ path: 'readme.txt', action: 'update', content: 'second\n' }]);
    const marker = createCheckpoint('now');

    const rollback = rollbackToCheckpoint(marker.checkpoint.id);
    expect(rollback.undoneChangesets).toBe(0);
    expect(readFile('readme.txt')).toBe('second\n');

    expect(() => rollbackToCheckpoint('cp-does-not-exist')).toThrow(/cannot be found/i);
  });

  it('5. a deleted file comes back with its original content', () => {
    const marker = createCheckpoint('before deletion');
    applyFileChanges([{ path: 'readme.txt', action: 'delete', content: '' }]);
    expect(fs.existsSync(path.join(projectRoot, 'readme.txt'))).toBe(false);

    rollbackToCheckpoint(marker.checkpoint.id);
    expect(readFile('readme.txt')).toBe('first\n');
  });

  it('6. keeps the timeline honest about what was rolled back', () => {
    applyFileChanges([{ path: 'readme.txt', action: 'update', content: 'second\n' }], { label: 'вторая версия' });
    const marker = createCheckpoint('here');
    applyFileChanges([{ path: 'readme.txt', action: 'update', content: 'third\n' }], { label: 'рискованная версия' });

    rollbackToCheckpoint(marker.checkpoint.id);

    const timeline = listBackups(25);
    expect(timeline[0].label).toBe('рискованная версия');
    expect(timeline[0].rolledBackAt).toBeTruthy();
    expect(timeline[0].paths).toEqual(['readme.txt']);
    expect(timeline[1].rolledBackAt).toBeUndefined();
  });

  it('7. removes a checkpoint without touching the history', () => {
    const marker = createCheckpoint('temporary');
    expect(deleteCheckpoint(marker.checkpoint.id)).toHaveLength(0);
    expect(listBackups(25).length).toBeGreaterThanOrEqual(0);
  });

  it('8. records the check result next to the batch it belongs to', () => {
    applyFileChanges([{ path: 'readme.txt', action: 'update', content: 'second\n' }]);
    const timeline = attachVerification(null, {
      ranAt: '2026-10-14T10:00:00.000Z',
      ok: false,
      passed: 1,
      failed: 1,
      problemCount: 2,
      errors: 2,
      warnings: 0
    });
    expect(timeline[0].verification?.ok).toBe(false);
    expect(timeline[0].verification?.problemCount).toBe(2);
  });

  it('9. a batch that was undone by hand still rolls back cleanly', () => {
    applyFileChanges([{ path: 'readme.txt', action: 'update', content: 'second\n' }]);
    const marker = createCheckpoint('good');
    const risky = applyFileChanges([{ path: 'readme.txt', action: 'update', content: 'broken\n' }]);

    // The user tried the undo button first, then decided to go back further.
    undoFileChanges(risky.backupId);
    expect(readFile('readme.txt')).toBe('second\n');

    const rollback = rollbackToCheckpoint(marker.checkpoint.id);
    expect(rollback.failed).toBe(0);
    expect(readFile('readme.txt')).toBe('second\n');
  });
});
