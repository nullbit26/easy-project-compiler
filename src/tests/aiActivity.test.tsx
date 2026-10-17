import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { AiActivityIndicator } from '../components/AiActivityIndicator';
import { getAiActivity, resetAiActivityForTests, trackAiRequest } from '../services/aiActivity';
import { compilePromptApi } from '../services/api';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('AI activity indicator', () => {
  beforeEach(() => {
    resetAiActivityForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // Unmount before resetting the store: a reset while the indicator is mounted would be a
    // state update outside act().
    cleanup();
    resetAiActivityForTests();
  });

  it('1. Stays hidden while nothing is running', () => {
    render(<AiActivityIndicator />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('2. Names the work in progress and counts the seconds', async () => {
    render(<AiActivityIndicator />);

    let finish!: () => void;
    let pending!: Promise<void>;
    await act(async () => {
      pending = trackAiRequest(
        'compile',
        () => new Promise<void>((resolve) => {
          finish = resolve;
        })
      );
    });

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(screen.getByText('Компилирую промпт')).toBeInTheDocument();
    expect(screen.getByText(/^\d+ с$/)).toBeInTheDocument();

    await act(async () => {
      finish();
      await pending;
    });

    // The user sees the transition instead of the panel silently changing.
    expect(screen.getByText('Готово')).toBeInTheDocument();
    expect(getAiActivity().active).toBe(false);
  });

  it('3. Explains a long wait instead of spinning in silence', async () => {
    vi.useFakeTimers();
    render(<AiActivityIndicator />);

    await act(async () => {
      trackAiRequest('review', () => new Promise<void>(() => {}));
      await Promise.resolve();
    });

    expect(screen.queryByText(/30–60 секунд/)).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(20000);
    });

    expect(screen.getByText(/30–60 секунд/)).toBeInTheDocument();
  });

  it('4. Reports the seconds that have actually passed', async () => {
    vi.useFakeTimers();
    render(<AiActivityIndicator />);

    await act(async () => {
      trackAiRequest('diagnose', () => new Promise<void>(() => {}));
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(42000);
    });

    expect(screen.getByText('42 с')).toBeInTheDocument();
    expect(screen.getByText(/30–60 секунд/)).toBeInTheDocument();

    // Only past the slow threshold does the hint explain the local fallback.
    await act(async () => {
      vi.advanceTimersByTime(60000);
    });

    expect(screen.getByText('102 с')).toBeInTheDocument();
    expect(screen.getByText(/локальным движком/)).toBeInTheDocument();
    expect(screen.queryByText(/30–60 секунд/)).not.toBeInTheDocument();
  });

  it('5. Clears the status when a request fails, so it can never stick', async () => {
    const pending = trackAiRequest('idea', () => Promise.reject(new Error('backend down')));

    await expect(pending).rejects.toThrow('backend down');
    expect(getAiActivity().active).toBe(false);
    expect(getAiActivity().activeCount).toBe(0);
  });

  it('5b. Reports a failure as a failure instead of a finished job', async () => {
    render(<AiActivityIndicator />);

    let failed!: Promise<string>;
    await act(async () => {
      failed = trackAiRequest('diagnose', () => Promise.reject(new Error('rate limited')));
      await failed.catch(() => undefined);
    });
    await expect(failed).rejects.toThrow('rate limited');

    expect(getAiActivity().outcome).toBe('error');
    expect(screen.getByText('Не получилось — подробности в ошибке')).toBeInTheDocument();
    expect(screen.queryByText('Готово')).not.toBeInTheDocument();

    // A later success must clear the failure state.
    await act(async () => {
      await trackAiRequest('compile', () => Promise.resolve('ok'));
    });

    expect(getAiActivity().outcome).toBe('success');
    expect(screen.getByText('Готово')).toBeInTheDocument();
  });

  it('6. The API layer reports every AI call it starts', async () => {
    const response = deferred<any>();
    vi.stubGlobal('fetch', vi.fn(() => response.promise));

    const call = compilePromptApi({
      userRequest: 'Добавить фильтр расходов',
      projectMap: { projectName: 'Расходы' } as any,
      agent: 'Cursor',
      contextMode: 'Balanced'
    });

    await waitFor(() => expect(getAiActivity().active).toBe(true));
    expect(getAiActivity().kind).toBe('compile');

    await act(async () => {
      response.resolve({ ok: true, json: async () => ({ data: { taskTitle: 'Фильтр расходов' } }) });
      await call;
    });

    expect(getAiActivity().active).toBe(false);
    expect(getAiActivity().finishedAt).not.toBeNull();
  });
});
