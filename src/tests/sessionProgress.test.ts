import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  finishSessionProgress,
  getSessionProgress,
  resetSessionProgressForTests,
  setSessionPhase,
  startSessionProgress,
  subscribeSessionProgress
} from '../services/sessionProgress';

/**
 * The sign that a run of the loop is under way.
 *
 * Four attempts into a task, the only evidence that the app was working on it lived in one spinner
 * inside one card — and the screen could be scrolled away from, or another tab opened. The store is
 * what lets the sidebar say otherwise. What matters, and is pinned here: a run knows its task and
 * its attempt, a finished run stops being active without losing the number it judged, and a phase
 * can never be set on a run that is not open.
 */

beforeEach(() => {
  resetSessionProgressForTests();
});

describe('A run of the session', () => {
  it('1. opens with its task, its attempt and its phase', () => {
    startSessionProgress({ taskId: 'task_1', taskTitle: 'Кнопка сохранения', attempt: 4, phase: 'reviewing' });
    const snapshot = getSessionProgress();

    expect(snapshot.active).toBe(true);
    expect(snapshot.taskId).toBe('task_1');
    expect(snapshot.attempt).toBe(4);
    expect(snapshot.phase).toBe('reviewing');
    expect(snapshot.startedAt).toBeGreaterThan(0);
  });

  it('2. moves between stages, and ignores a stage when nothing is running', () => {
    setSessionPhase('writing');
    expect(getSessionProgress().active).toBe(false);

    startSessionProgress({ attempt: 1, phase: 'writing' });
    setSessionPhase('reviewing');
    expect(getSessionProgress().phase).toBe('reviewing');

    finishSessionProgress();
    setSessionPhase('writing');
    expect(getSessionProgress().phase).toBeNull();
  });

  it('3. closing it stops the sign but keeps the number that was judged', () => {
    startSessionProgress({ taskTitle: 'Кнопка', attempt: 3, phase: 'reviewing' });
    finishSessionProgress();

    expect(getSessionProgress().active).toBe(false);
    expect(getSessionProgress().phase).toBeNull();
    // The attempt stays readable: the screen flashes "attempt 3 finished" out of the same store.
    expect(getSessionProgress().attempt).toBe(3);
    expect(getSessionProgress().taskTitle).toBe('');
  });

  it('4. subscribers are told about every change, and stop being told after they leave', () => {
    const seen = vi.fn();
    const unsubscribe = subscribeSessionProgress(seen);

    startSessionProgress({ attempt: 2, phase: 'reviewing' });
    expect(seen).toHaveBeenCalledTimes(1);

    setSessionPhase('reviewing');
    // The same stage twice is not a change: a re-render per no-op is how a blinking indicator
    // becomes a flickering one.
    expect(seen).toHaveBeenCalledTimes(1);

    setSessionPhase('writing');
    expect(seen).toHaveBeenCalledTimes(2);

    unsubscribe();
    finishSessionProgress();
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
