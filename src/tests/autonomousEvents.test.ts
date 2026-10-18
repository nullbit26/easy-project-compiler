import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AutonomousEventLog } from '../../server/services/autonomousEvents';

/**
 * The event log is the part of the autonomous loop the user actually sees: every step lands as a
 * line, a reconnecting reader replays the whole run, and an ended run stays readable.
 */

describe('The autonomous event log', () => {
  let log: AutonomousEventLog;

  beforeEach(() => {
    log = new AutonomousEventLog();
  });

  it('1. gives every event a sequence number and a timestamp', () => {
    log.begin({ runId: 'r1', taskTitle: 'T', startedAt: 'now', maxAttempts: 4 });

    const first = log.push({ runId: 'r1', seq: 0, type: 'run_started', text: 'go' });
    const second = log.push({ runId: 'r1', seq: 0, type: 'verifying', text: 'checks' });

    expect(second.seq).toBe(first.seq + 1);
    expect(first.at).toBeTruthy();
    expect(new Date(first.at).getTime()).not.toBeNaN();
  });

  it('2. delivers a pushed event to every live subscriber', () => {
    log.begin({ runId: 'r1', taskTitle: 'T', startedAt: 'now', maxAttempts: 4 });
    const seen: string[] = [];
    log.subscribe((event) => seen.push(event.type));
    log.push({ runId: 'r1', seq: 0, type: 'files_written', text: 'w' });

    expect(seen).toEqual(['files_written']);
  });

  it('3. survives a subscriber that throws', () => {
    log.begin({ runId: 'r1', taskTitle: 'T', startedAt: 'now', maxAttempts: 4 });
    const seen: string[] = [];
    log.subscribe(() => {
      throw new Error('broken SSE writer');
    });
    log.subscribe((event) => seen.push(event.type));

    expect(() => log.push({ runId: 'r1', seq: 0, type: 'verifying', text: 'x' })).not.toThrow();
    expect(seen).toEqual(['verifying']);
  });

  it('4. marks a run completed when its terminal event arrives', () => {
    log.begin({ runId: 'r1', taskTitle: 'T', startedAt: 'now', maxAttempts: 4 });
    log.push({
      runId: 'r1',
      seq: 0,
      type: 'run_completed',
      attempt: 2,
      text: 'done',
      detail: { backupId: 'bk-1', verdict: 'pass' }
    });

    const run = log.descriptor('r1');
    expect(run?.status).toBe('completed');
    expect(run?.attempts).toBe(2);
    expect(run?.backupId).toBe('bk-1');
    expect(run?.verdict).toBe('pass');
  });

  it('5. marks a run failed and keeps its last error', () => {
    log.begin({ runId: 'r1', taskTitle: 'T', startedAt: 'now', maxAttempts: 4 });
    log.push({ runId: 'r1', seq: 0, type: 'run_failed', text: 'stopped', detail: { error: 'tsc exited 2' } });

    const run = log.descriptor('r1');
    expect(run?.status).toBe('failed');
    expect(run?.lastError).toBe('tsc exited 2');
  });

  it('6. replays only the requested run, oldest first', () => {
    log.begin({ runId: 'a', taskTitle: 'A', startedAt: 'now', maxAttempts: 4 });
    log.begin({ runId: 'b', taskTitle: 'B', startedAt: 'now', maxAttempts: 4 });
    log.push({ runId: 'a', seq: 0, type: 'run_started', text: '1' });
    log.push({ runId: 'b', seq: 0, type: 'run_started', text: '2' });
    log.push({ runId: 'a', seq: 0, type: 'verifying', text: '3' });

    expect(log.replay('a').map((e) => e.text)).toEqual(['1', '3']);
    expect(log.replay('b').map((e) => e.text)).toEqual(['2']);
  });

  it('7. says a run still running is not over, and an interrupted one is not failed', () => {
    log.begin({ runId: 'r1', taskTitle: 'T', startedAt: 'now', maxAttempts: 4 });

    expect(log.descriptor('r1')?.status).toBe('running');
    log.markInterrupted('r1');
    expect(log.descriptor('r1')?.status).toBe('interrupted');

    log.markInterrupted('r1');
    // A run that already ended is not rewritten into "interrupted" by a late notice.
    log.begin({ runId: 'r2', taskTitle: 'T', startedAt: 'now', maxAttempts: 4 });
    log.push({ runId: 'r2', seq: 0, type: 'run_completed', attempt: 1, text: 'ok' });
    log.markInterrupted('r2');
    expect(log.descriptor('r2')?.status).toBe('completed');
  });

  it('8. lets a run be patched with where it stands', () => {
    log.begin({ runId: 'r1', taskTitle: 'T', startedAt: 'now', maxAttempts: 4 });
    log.update('r1', { backupId: 'bk-7', verdict: 'fail' });

    expect(log.descriptor('r1')).toMatchObject({ backupId: 'bk-7', verdict: 'fail' });
  });

  it('9. unsubscribes cleanly when the SSE response goes away', () => {
    log.begin({ runId: 'r1', taskTitle: 'T', startedAt: 'now', maxAttempts: 4 });
    const seen: string[] = [];
    const off = log.subscribe((event) => seen.push(event.type));
    off();
    log.push({ runId: 'r1', seq: 0, type: 'verifying', text: 'x' });

    expect(seen).toEqual([]);
  });
});
