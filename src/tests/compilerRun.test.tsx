import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';

/**
 * The compiler used to answer with a spinner and one grey sentence while the model took a minute
 * to write the prompt. It now opens the same terminal as the beginner flow: the request's own
 * facts first, then each model as it is tried, then the text being written right now — and the
 * same stop button. What this file pins is that the screen says what it is waiting for and that
 * stopping it is a stop, not a failure.
 */

function makeProject() {
  return {
    id: 'compiler-run-demo',
    name: 'Island Survival',
    projectType: 'Phaser.js',
    engineOrFramework: 'Phaser 3',
    language: 'JavaScript',
    selectedAgent: 'DeepSeek / Web Chat',
    technicalLevel: 'Intermediate',
    nextBestAction: 'Run the first task',
    brief: {
      id: 'b1',
      projectName: 'Island Survival',
      tagline: 'A demo',
      targetAudience: 'Testers',
      coreProblem: 'Nothing',
      coreValue: 'Nothing',
      mvpFeatures: ['Feature'],
      futureFeatures: [],
      nonGoals: [],
      technicalConstraints: [],
      successCriteria: []
    },
    projectMap: {
      projectName: 'Island Survival',
      projectType: 'Phaser.js',
      engineOrFramework: 'Phaser 3',
      language: 'JavaScript',
      rulesFiles: ['AGENTS.md'],
      files: [{ path: 'src/main.js', type: 'code', description: 'Main entry point' }]
    },
    phases: [
      {
        id: 'p0',
        phaseNumber: 0,
        title: 'Setup',
        purpose: 'Setup',
        deliverable: 'Working shell',
        tasks: [
          {
            id: 't1',
            title: 'Загрузить сцену острова',
            goal: 'Ship something',
            status: 'ready',
            acceptanceCriteria: [],
            dependencies: [],
            progressPercent: 0
          }
        ]
      }
    ],
    recentErrors: [],
    rulesFilesContent: {
      agentsMd: '# AGENTS.md\n\n- Keep `src/main.js` small\n',
      claudeMd: '# CLAUDE.md\n\n@AGENTS.md\n',
      cursorRules: '# Rules\n'
    }
  };
}

const COMPILED = {
  taskTitle: 'Загрузить сцену острова',
  confidence: 90,
  includedFiles: [],
  excludedFiles: [],
  missingContext: [],
  architectureWarnings: [],
  promptText: 'PROMPT FROM THE MODEL',
  acceptanceCriteria: [],
  tests: [],
  estimatedTokens: 120,
  nextBestAction: 'Copy it',
  securityWarnings: [],
  contextMode: 'Balanced',
  createdAt: new Date().toISOString()
};

/** The response a live compile route sends: frames, read one at a time, with the last held open. */
function streamResponse(frames: string[], release: { current: (() => void) | null }, signal?: AbortSignal) {
  const encoder = new TextEncoder();
  let index = 0;
  const gate = new Promise<void>((resolve) => {
    release.current = resolve;
  });
  const abortError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal?.aborted) reject(abortError());
    signal?.addEventListener('abort', () => reject(abortError()), { once: true });
  });
  aborted.catch(() => {
    /* Only the raced read listens to this. */
  });
  const reader = {
    read: async () => {
      if (signal?.aborted) throw abortError();
      if (index >= frames.length) return { done: true, value: undefined };
      // The result frame waits: the screen is read while the model is still writing.
      if (index === frames.length - 1) await Promise.race([gate, aborted]);
      if (signal?.aborted) throw abortError();
      return { done: false, value: encoder.encode(frames[index++]) };
    },
    releaseLock: () => {}
  };
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'text/event-stream; charset=utf-8' : null)
    },
    body: { getReader: () => reader }
  } as unknown as Response;
}

function mockCompile() {
  const release: { current: (() => void) | null } = { current: null };
  const frame = (payload: any) => `data: ${JSON.stringify(payload)}\n\n`;
  const spy = vi.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    if (url.includes('/api/prompt/compile')) {
      return Promise.resolve(
        streamResponse(
          [
            frame({ type: 'attempt', provider: 'openrouter', model: 'deepseek/deepseek-chat' }),
            frame({ type: 'delta', text: '{"taskTitle":"Загрузить сцену острова","promptText":"' }),
            frame({ type: 'delta', text: 'пишу промпт прямо сейчас"}' }),
            frame({ type: 'result', success: true, data: COMPILED, engine: 'openrouter' })
          ],
          release,
          init?.signal
        )
      );
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: {} }) } as unknown as Response);
  });
  return { spy, release };
}

function openCompiler() {
  const project = makeProject();
  localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
  localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
  localStorage.setItem('easy_project_compiler_lang', 'ru');
  window.location.hash = '#/compiler';
  return mockCompile();
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('The compiler shows the run it is waiting on', () => {
  it('1. opens a terminal with the request’s facts and the model’s own text, not a spinner', async () => {
    const { release } = openCompiler();
    render(<App />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Начать' }))[0]);

    await waitFor(() => expect(document.querySelector('[data-run-terminal]')).not.toBeNull(), { timeout: 4000 });

    const log = screen.getByRole('log');
    // The task travels with the request, and the screen says so before anything comes back.
    expect(log.textContent).toContain('Загрузить сцену острова');
    expect(log.textContent).toContain('POST /api/prompt/compile?stream=1');
    // The model that was tried, and what it is writing right now.
    await waitFor(() => expect(log.textContent).toContain('openrouter / deepseek/deepseek-chat'), { timeout: 4000 });
    await waitFor(
      () => expect(document.querySelector('[data-run-trace]')?.textContent).toContain('пишу промпт прямо сейчас'),
      { timeout: 4000 }
    );

    // The prompt is not claimed before its answer is complete.
    expect(screen.queryByText('PROMPT FROM THE MODEL')).toBeNull();

    release.current?.();
    await waitFor(() => expect(screen.getByText('PROMPT FROM THE MODEL')).toBeInTheDocument(), { timeout: 4000 });
  }, 20000);

  it('2. stops the compile from the terminal, and keeps the log it was reading', async () => {
    const { spy } = openCompiler();
    render(<App />);

    fireEvent.click((await screen.findAllByRole('button', { name: 'Начать' }))[0]);

    // One control, named twice for mouse and screen reader.
    const cancel = await screen.findByRole('button', { name: 'Отменить' });
    expect(cancel.getAttribute('title')).toBe('Отменить');
    fireEvent.click(cancel);

    const compileCall = spy.mock.calls.find((call: any[]) =>
      String(typeof call[0] === 'string' ? call[0] : call[0]?.url ?? '').includes('/api/prompt/compile')
    ) as any[];
    await waitFor(() => expect(compileCall[1].signal.aborted).toBe(true));

    // The log stays where the prompt would have appeared, and says how it ended — a stop, not a bug.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull(), { timeout: 4000 });
    expect(screen.getByRole('log').textContent).toContain('Отменено');
    expect(screen.queryByText(/Не удалось|Failed to compile/)).toBeNull();
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument();
    expect(screen.queryByText('PROMPT FROM THE MODEL')).toBeNull();
  }, 20000);
});
