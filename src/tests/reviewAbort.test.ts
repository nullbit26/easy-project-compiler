import { describe, it, expect, vi } from 'vitest';

/**
 * The review keeps its provider call open while the verdict is written. When the reader cancels,
 * the response closes and the request has to be aborted — otherwise the same tokens are paid for
 * twice and the fallback chain walks on to the next model with no one waiting.
 */

const captured = vi.hoisted(() => ({
  signal: null as AbortSignal | null,
  calls: 0
}));

vi.mock('../../server/ai/aiProvider', () => ({
  hasAiProvider: () => true,
  getEngineLabel: () => 'openrouter',
  callAiJson: async (_prompt: string, _schema: any, options: any) => {
    captured.calls += 1;
    captured.signal = options?.signal ?? null;
    if (!captured.signal) return null;
    // Holds the request open the way a real provider does, until it is aborted.
    await new Promise<void>((resolve) => {
      if (captured.signal!.aborted) return resolve();
      captured.signal!.addEventListener('abort', () => resolve(), { once: true });
    });
    return null;
  }
}));

import { reviewSession } from '../../server/controllers/session.controller';

describe('A cancelled review', () => {
  it('1. aborts the provider request when the reader goes away', async () => {
    let onClose: (() => void) | null = null;
    const res: any = {
      json: () => res,
      status: () => res,
      on: (event: string, callback: () => void) => {
        if (event === 'close') onClose = callback;
      }
    };
    const req: any = {
      body: {
        agentOutput: 'Готово: кнопка добавлена в src/main.ts',
        task: {
          title: 'Кнопка сохранения',
          goal: 'Кнопка сохраняет прогресс',
          acceptanceCriteria: [{ description: 'Кнопка есть' }]
        },
        projectMap: { projectName: 'Заметки', projectType: 'React', language: 'TypeScript', files: [] },
        stepNumber: 1,
        previousHistory: [],
        language: 'ru',
        skillLevel: 'Beginner / Non-coder'
      }
    };

    const pending = reviewSession(req, res);
    expect(captured.calls).toBe(1);
    expect(captured.signal).not.toBeNull();
    expect(captured.signal!.aborted).toBe(false);

    // The window closed, or the terminal's stop button aborted the fetch.
    onClose?.();
    expect(captured.signal!.aborted).toBe(true);

    await pending;
  });
});
