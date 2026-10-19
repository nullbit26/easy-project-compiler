import { beforeEach, describe, expect, it } from 'vitest';
import { autopilotFeed } from '../services/autopilotFeed';
import type { AutonomousEvent } from '../services/api';

/**
 * The log the studio's terminal reads.
 *
 * It is a store rather than component state because the run is started in one window and watched
 * in another, and it is fed by an SSE stream that replays events on reconnect: the two things
 * worth pinning are that a replayed event does not become a duplicated line, and that the run's
 * status follows the terminal events rather than the last line's wording.
 */

const event = (over: Partial<AutonomousEvent> = {}): AutonomousEvent => ({
  runId: 'run-1',
  seq: 1,
  type: 'attempt_started',
  at: new Date().toISOString(),
  text: 'Attempt #1',
  ...over
});

beforeEach(() => {
  autopilotFeed.clear();
});

describe('The autopilot feed', () => {
  it('1. starts a run with its title and accepts the same event only once', () => {
    autopilotFeed.begin({ title: 'Add a delete button', total: 0, maxAttempts: 4 });
    expect(autopilotFeed.snapshot().status).toBe('running');
    expect(autopilotFeed.snapshot().title).toBe('Add a delete button');

    autopilotFeed.push(event(), 'Attempt #1');
    autopilotFeed.push(event(), 'Attempt #1');
    autopilotFeed.push(event({ seq: 2, type: 'files_written', text: 'created: src/App.tsx' }), 'created: src/App.tsx');

    const lines = autopilotFeed.snapshot().lines;
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe('Attempt #1');
    expect(lines[1].tone).toBe('success');
  });

  it('2. follows the run from running to completed or failed', () => {
    autopilotFeed.begin({ title: 'Task', total: 1 });
    autopilotFeed.push(event({ seq: 3, type: 'verdict', attempt: 2, text: 'checks: 3 passed' }), 'Проверки: 3 passed');
    expect(autopilotFeed.snapshot().status).toBe('running');
    expect(autopilotFeed.snapshot().attempt).toBe(2);

    autopilotFeed.push(event({ seq: 4, type: 'run_completed', text: 'Completed in 1 attempt(s)' }), 'Completed');
    expect(autopilotFeed.snapshot().status).toBe('completed');
    expect(autopilotFeed.snapshot().lines.at(-1)?.tone).toBe('success');

    autopilotFeed.begin({ title: 'Another task' });
    autopilotFeed.fail('The run could not start.');
    expect(autopilotFeed.snapshot().status).toBe('failed');
    expect(autopilotFeed.snapshot().lines).toHaveLength(1);
    expect(autopilotFeed.snapshot().lines[0].tone).toBe('error');
  });

  it('3. keeps the pipeline counters and empties on clear', () => {
    autopilotFeed.begin({ title: 'The plan', total: 4 });
    autopilotFeed.markDone(2, 4);
    expect(autopilotFeed.snapshot().done).toBe(2);
    expect(autopilotFeed.snapshot().total).toBe(4);

    autopilotFeed.configure({ maxAttempts: 6 });
    expect(autopilotFeed.snapshot().maxAttempts).toBe(6);

    autopilotFeed.clear();
    expect(autopilotFeed.snapshot()).toMatchObject({ status: 'idle', lines: [], title: '', done: 0 });
  });
});
