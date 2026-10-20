import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import App from '../App';

/**
 * The beginner mode: a project set to "Beginner / Non-coder" must open the four-step helper
 * instead of the metric dashboard, hide the eight technical screens behind one click, and only
 * ever call the AI when the user presses the button on the current step.
 */

const task = {
  id: 'task_simple',
  phaseId: 'p0',
  title: 'Сделать кнопку сохранения',
  goal: 'Кнопка сохраняет прогресс',
  status: 'ready',
  relevantFiles: ['src/main.ts'],
  acceptanceCriteria: [{ id: 'ac1', description: 'Кнопка сохраняет', passed: false }],
  testRequirements: [],
  estimatedComplexity: 'Small (1 prompt)',
  dependencies: [],
  progressPercent: 0
};

function makeProject(technicalLevel: string) {
  return {
    id: `simple-${technicalLevel}`,
    name: 'Простой проект',
    projectType: 'React',
    engineOrFramework: 'React 19 + Vite',
    language: 'TypeScript',
    selectedAgent: 'DeepSeek / Web Chat',
    technicalLevel,
    nextBestAction: 'Выполнить первую задачу',
    brief: {
      id: 'b1',
      projectName: 'Простой проект',
      tagline: 'Демо',
      targetAudience: 'Все',
      coreProblem: 'Ничего',
      coreValue: 'Ничего',
      mvpFeatures: ['Кнопка сохранения'],
      futureFeatures: [],
      nonGoals: [],
      technicalConstraints: [],
      successCriteria: []
    },
    architecture: {
      technologyStack: ['React'],
      folderStructure: [],
      coreEntities: [],
      dataFlow: 'ui -> api',
      testingStrategy: 'vitest',
      deploymentPlan: 'static',
      securityRisks: []
    },
    projectMap: {
      projectName: 'Простой проект',
      projectType: 'React',
      engineOrFramework: 'React 19 + Vite',
      language: 'TypeScript',
      rulesFiles: ['AGENTS.md'],
      files: [
        { path: 'src/main.ts', type: 'code', description: 'src • 40 B' },
        { path: 'README.md', type: 'asset', description: '. • 20 B' }
      ]
    },
    phases: [{ id: 'p0', phaseNumber: 1, title: 'Этап 1', purpose: 'Старт', deliverable: 'Работает', tasks: [task] }],
    recentErrors: [],
    rulesFilesContent: { agentsMd: '', claudeMd: '', cursorRules: '' }
  };
}

const compiledPrompt = {
  id: 'c1',
  taskId: 'task_simple',
  agent: 'DeepSeek / Web Chat',
  projectType: 'React',
  engineOrFramework: 'React 19 + Vite',
  language: 'TypeScript',
  taskTitle: 'Сделать кнопку сохранения',
  confidence: 90,
  includedFiles: [{ path: 'src/main.ts', reason: 'Основной файл', tokensEstimate: 120 }],
  excludedFiles: [],
  missingContext: [],
  architectureWarnings: [],
  promptText: 'СОБРАННЫЙ ПРОМПТ ДЛЯ НОВИЧКА',
  acceptanceCriteria: ['Кнопка работает'],
  tests: ['Проверить кнопку'],
  estimatedTokens: 200,
  nextBestAction: 'Вставить промпт в DeepSeek',
  securityWarnings: [],
  contextMode: 'Balanced',
  createdAt: new Date().toISOString()
};

/** What the reviewer answers when everything the task asked for is in the pasted code. */
const completedReview = {
  id: 'r1',
  taskId: 'task_simple',
  status: 'Completed',
  progressPercent: 100,
  completedCriteria: ['Кнопка работает'],
  missingCriteria: [],
  warnings: [],
  unintendedChanges: [],
  nextBestAction: 'Задача закрыта, берите следующую',
  agentOutputSummary: 'Кнопка сохранения добавлена и работает',
  continuationPrompt: ''
};

/**
 * What the app's own check run answers for this folder: a type check that fails.
 *
 * It is the fact the loop was missing — the verdict used to ask the beginner to run `tsc` and
 * `npm install` in a folder the app can run itself, while 0% next to a failing build looked like a
 * verdict about the answer alone.
 */
const failingVerification = {
  ranAt: new Date().toISOString(),
  root: 'C:/demo-project',
  ok: false,
  passed: 0,
  failed: 1,
  skipped: 0,
  durationMs: 2100,
  problems: [
    {
      severity: 'error',
      message: "Type 'string' is not assignable to type 'number'",
      code: 'TS2322',
      raw: 'src/main.ts(12,5): error TS2322: Type \u0027string\u0027 is not assignable to type \u0027number\u0027',
      file: 'src/main.ts',
      line: 12,
      column: 5
    }
  ],
  results: [
    {
      id: 'typecheck:tsc',
      kind: 'typecheck',
      key: 'tsc',
      labelRu: 'Проверка типов',
      labelEn: 'Type check',
      commandLine: 'node node_modules/typescript/bin/tsc --noEmit --pretty false',
      tokens: ['node', 'node_modules/typescript/bin/tsc', '--noEmit'],
      status: 'failed',
      exitCode: 1,
      durationMs: 2100,
      problems: [],
      output: '',
      outputTruncated: false
    }
  ],
  summary: {
    ranAt: new Date().toISOString(),
    ok: false,
    passed: 0,
    failed: 1,
    problemCount: 1,
    errors: 1,
    warnings: 0
  },
  timeline: [],
  checkpoints: []
};

/** Set while a review is deliberately left hanging, so the screen can be looked at mid-flight. */
let releaseReview: ((data: any) => void) | null = null;
/** The same, for the compile request: the terminal is only readable while it is open. */
let releaseCompile: ((data: any) => void) | null = null;
/** Holds the last frame of a streamed compile, so the live view can be looked at mid-request. */
let releaseStream: (() => void) | null = null;

/**
 * A streaming answer, frame by frame.
 *
 * Deliberately not a real `Response`: the test needs to hand over one frame at a time and to keep
 * the final frame (the result) waiting until the screen has been read. The object carries exactly
 * what the API layer reads — status, content type and a reader.
 */
function streamResponse(frames: string[], holdLast = false, signal?: AbortSignal) {
  const encoder = new TextEncoder();
  let index = 0;
  const gate = new Promise<void>((resolve) => {
    releaseStream = resolve;
  });
  const abortError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
  // What a real `fetch` does when its signal is aborted: the pending read rejects.
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
      if (holdLast && index === frames.length - 1) await Promise.race([gate, aborted]);
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

function mockApi(
  reviewData: any = completedReview,
  options: {
    deferReview?: boolean;
    deferCompile?: boolean;
    failCompile?: boolean;
    verification?: any;
    /** Answer the compile the way the live route does, one frame at a time. */
    streamCompile?: boolean;
    /** Keep the result frame waiting until `releaseStream` is called. */
    holdStream?: boolean;
  } = {}
) {
  const spy = vi.spyOn(global, 'fetch').mockImplementation((input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input?.url ?? '';
    const respond = (data: any) =>
      Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);

    if (url.includes('/api/files/workspace')) {
      return respond({
        root: 'C:/demo-project',
        files: [
          { path: 'src/main.ts', name: 'main.ts', dir: 'src', type: 'code', sizeBytes: 40, isText: true },
          { path: 'README.md', name: 'README.md', dir: '', type: 'asset', sizeBytes: 20, isText: true }
        ],
        backups: []
      });
    }
    if (url.includes('/api/prompt/compile')) {
      if (options.failCompile) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ success: false, error: 'Модель недоступна' })
        } as unknown as Response);
      }
      if (options.deferCompile) {
        return new Promise<Response>((resolve) => {
          releaseCompile = (data: any) =>
            resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);
        });
      }
      if (options.streamCompile) {
        const frame = (payload: any) => `data: ${JSON.stringify(payload)}\n\n`;
        return Promise.resolve(
          streamResponse(
            [
              frame({ type: 'attempt', provider: 'openrouter', model: 'deepseek/deepseek-chat' }),
              frame({
                type: 'delta',
                text: '{"taskTitle":"Сделать кнопку сохранения","includedFiles":[],"promptText":"'
              }),
              frame({ type: 'delta', text: 'живой поток"}' }),
              frame({
                type: 'result',
                success: true,
                data: { ...compiledPrompt, promptText: 'СОБРАННЫЙ ПРОМПТ ДЛЯ НОВИЧКА' },
                engine: 'openrouter'
              })
            ],
            options.holdStream,
            init?.signal
          )
        );
      }
      return respond(compiledPrompt);
    }
    if (url.includes('/api/files/checks')) {
      return respond({
        checks: [
          {
            id: 'typecheck:tsc',
            kind: 'typecheck',
            key: 'tsc',
            labelRu: 'Проверка типов',
            labelEn: 'Type check',
            commandLine: 'node node_modules/typescript/bin/tsc --noEmit --pretty false',
            tokens: ['node', 'node_modules/typescript/bin/tsc', '--noEmit']
          }
        ]
      });
    }
    if (url.includes('/api/files/verify')) return respond(options.verification ?? failingVerification);
    if (url.includes('/api/session/review')) {
      if (options.deferReview) {
        // A real answer takes 30-60 seconds; the test holds it open to look at the screen.
        return new Promise<Response>((resolve, reject) => {
          releaseReview = (data: any) =>
            resolve({ ok: true, status: 200, json: async () => ({ success: true, data }) } as unknown as Response);
          // Cancelling aborts the request, and a real fetch rejects its pending promise.
          init?.signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })),
            { once: true }
          );
        });
      }
      return respond(reviewData);
    }
    if (url.includes('/api/files/apply')) {
      return respond({
        backupId: 'b1',
        root: 'C:/demo-project',
        results: [{ path: 'src/main.ts', action: 'update', status: 'updated' }],
        applied: 1,
        failed: 0,
        backups: []
      });
    }
    return respond({});
  });
  return spy;
}

function callCount(spy: any, part: string): number {
  return spy.mock.calls.filter((call: any[]) => {
    const url = typeof call[0] === 'string' ? call[0] : call[0]?.url ?? '';
    return url.includes(part);
  }).length;
}

describe('Beginner step-by-step mode', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    window.location.hash = '';
  });

  it('opens the four-step flow, hides the technical screens and compiles only on demand', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const spy = mockApi();

    render(<App />);

    // A project that is already saved opens on the dashboard (see the start-up landing rule); the
    // helper is the first entry in the sidebar, one click away — and then it is what the beginner
    // lives in, instead of the metrics dashboard.
    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    // The sidebar shows the helper as the only workflow entry.
    expect(screen.getByRole('button', { name: /Пошаговый помощник/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Компилятор промптов' })).toBeNull();
    expect(screen.getByRole('button', { name: /Показать все разделы/ })).toBeInTheDocument();

    // Folder is already connected in the mock, so step 2 offers the task from the plan.
    await waitFor(() => expect(screen.getByText('Сделать кнопку сохранения')).toBeInTheDocument(), {
      timeout: 4000
    });
    expect(callCount(spy, '/api/prompt/compile')).toBe(0);

    // Nothing is compiled until the beginner presses the button.
    fireEvent.click(screen.getByRole('button', { name: /Собрать промпт/ }));
    await waitFor(() => expect(screen.getByText('СОБРАННЫЙ ПРОМПТ ДЛЯ НОВИЧКА')).toBeInTheDocument(), {
      timeout: 4000
    });
    expect(callCount(spy, '/api/prompt/compile')).toBe(1);

    // Step 3 → step 4, then the pasted answer is checked.
    fireEvent.click(screen.getByRole('button', { name: /Я вставил/ }));
    const answerBox = await screen.findByPlaceholderText('Вставьте ответ агента...');
    fireEvent.change(answerBox, {
      target: { value: 'Готово.\n\n### src/main.ts\n```ts\nconsole.log("saved");\n```\n' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Проверить ответ/ }));

    await waitFor(() => expect(screen.getByText('Всё сделано')).toBeInTheDocument(), { timeout: 4000 });
    expect(callCount(spy, '/api/session/review')).toBe(1);
    // The verdict is asked for in the project's own mode, so its wording fits the person reading it.
    const reviewCall = spy.mock.calls.find((entry: any[]) =>
      String(typeof entry[0] === 'string' ? entry[0] : entry[0]?.url ?? '').includes('/api/session/review')
    );
    expect(JSON.parse(String(reviewCall[1].body)).skillLevel).toBe('Beginner / Non-coder');
    expect(screen.getByText('Кнопка сохранения добавлена и работает')).toBeInTheDocument();

    // The code found in the answer can be written into the real folder, with an undo beside it.
    fireEvent.click(screen.getByRole('button', { name: /Записать код в файлы проекта/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Отменить запись/ })).toBeInTheDocument(), {
      timeout: 4000
    });
    expect(callCount(spy, '/api/files/apply')).toBe(1);
  });

  it('opens a live terminal the moment the prompt is requested, instead of a countdown card', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const spy = mockApi(completedReview, { deferCompile: true });
    render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    fireEvent.click(await screen.findByRole('button', { name: /Собрать промпт/ }));

    /*
     * The questionnaire does not wait beside a countdown: the form is replaced by the request's
     * own log, written before the answer arrives — the task, the agent and the endpoint.
     */
    const log = await screen.findByRole('log');
    expect(log.textContent).toContain('Сделать кнопку сохранения');
    expect(log.textContent).toContain('Агент: DeepSeek / Web Chat');
    expect(log.textContent).toContain('POST /api/prompt/compile');
    expect(screen.queryByPlaceholderText(/Например: добавить кнопку/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Собрать промпт/ })).toBeNull();

    // One status for the request: the terminal. The corner card counting seconds is not shown.
    expect(screen.queryByText('Компилирую промпт')).toBeNull();

    const entry = screen.getByRole('button', { name: /Пошаговый помощник/ });
    await waitFor(() => expect(entry.getAttribute('data-helper-running')).toBe('true'));
    expect(entry.className).toContain('epc-runner');

    releaseCompile?.(compiledPrompt);
    await waitFor(() => expect(screen.getByText('СОБРАННЫЙ ПРОМПТ ДЛЯ НОВИЧКА')).toBeInTheDocument(), {
      timeout: 4000
    });

    // The log closes with the work, and the prompt is on the next step.
    expect(screen.queryByRole('log')).toBeNull();
    await waitFor(() => expect(entry.getAttribute('data-helper-running')).toBe('false'));
    expect(callCount(spy, '/api/prompt/compile')).toBe(1);
  });

  it('shows the model writing the prompt, and names each step it reaches', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const spy = mockApi(completedReview, { streamCompile: true, holdStream: true });
    render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    fireEvent.click(await screen.findByRole('button', { name: /Собрать промпт/ }));

    /*
     * The answer is read while it is written: the terminal shows the model's own text, and the
     * keys the compiler writes become plain lines — which model answered, that it is writing the
     * prompt — instead of a countdown.
     */
    await waitFor(() => {
      const trace = document.querySelector('[data-run-trace]');
      expect(trace).not.toBeNull();
      expect(trace?.textContent).toContain('живой поток');
    }, { timeout: 4000 });

    const log = screen.getByRole('log');
    expect(log.textContent).toContain('Модель: openrouter / deepseek/deepseek-chat');
    expect(log.textContent).toContain('пишет промпт');
    expect(log.textContent).toContain('POST /api/prompt/compile?stream=1');

    // The waiting line is the app's animated mark, not a sentence; the words stay for a screen reader.
    const live = document.querySelector('[data-run-live]');
    expect(live?.querySelector('.epc-mosaic')).not.toBeNull();
    expect(live?.querySelector('.sr-only')?.textContent?.trim()).toBe('пишет ответ');

    // The reading is slate at three weights; a coloured line was the thing that made it look cheap.
    for (const line of Array.from(log.querySelectorAll('[data-run-line]'))) {
      expect(line.className).not.toMatch(/text-(sky|emerald|rose|indigo|violet)-/);
    }

    // The result frame is still on its way, so the prompt is not claimed to be ready.
    expect(screen.queryByText('СОБРАННЫЙ ПРОМПТ ДЛЯ НОВИЧКА')).toBeNull();

    releaseStream?.();
    await waitFor(() => expect(screen.getByText('СОБРАННЫЙ ПРОМПТ ДЛЯ НОВИЧКА')).toBeInTheDocument(), {
      timeout: 4000
    });
    expect(callCount(spy, '/api/prompt/compile')).toBe(1);
  });

  it('stops the request from the terminal, and calls that stopped rather than failed', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const spy = mockApi(completedReview, { streamCompile: true, holdStream: true });
    render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    fireEvent.click(await screen.findByRole('button', { name: /Собрать промпт/ }));

    // The running request carries one control, named twice for mouse and screen reader.
    const cancel = await screen.findByRole('button', { name: 'Отменить' });
    expect(cancel.getAttribute('title')).toBe('Отменить');
    fireEvent.click(cancel);

    // The stream is aborted, not left running behind a hidden card.
    const compileCall = spy.mock.calls.find((call: any[]) =>
      String(typeof call[0] === 'string' ? call[0] : call[0]?.url ?? '').includes('/api/prompt/compile')
    ) as any[];
    await waitFor(() => expect(compileCall[1].signal.aborted).toBe(true));

    // The log stays above the form and says how it ended — no failure, and nothing written to the
    // error line, because no error happened.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull(), { timeout: 4000 });
    const log = screen.getByRole('log');
    expect(log.textContent).toContain('Отменено');
    expect(screen.queryByText(/Не удалось собрать/)).toBeNull();
    expect(screen.getByPlaceholderText(/Например: добавить кнопку/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument();
    expect(callCount(spy, '/api/prompt/compile')).toBe(1);
  });

  it('stops the verdict, and keeps both the log and the answer that was being checked', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const spy = mockApi(completedReview, { deferReview: true });
    render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    // Get to step 4 the normal way: a built prompt, then a pasted answer.
    fireEvent.click(await screen.findByRole('button', { name: /Собрать промпт/ }));
    await waitFor(() => expect(screen.getByText('СОБРАННЫЙ ПРОМПТ ДЛЯ НОВИЧКА')).toBeInTheDocument(), {
      timeout: 4000
    });
    fireEvent.click(screen.getByRole('button', { name: /Я вставил/ }));

    const answerBox = await screen.findByPlaceholderText('Вставьте ответ агента...');
    fireEvent.change(answerBox, {
      target: { value: 'Готово.\n\n### src/main.ts\n```ts\nconsole.log("saved");\n```\n' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Проверить ответ/ }));

    const cancel = await screen.findByRole('button', { name: 'Отменить' });
    fireEvent.click(cancel);

    const reviewCall = spy.mock.calls.find((call: any[]) =>
      String(typeof call[0] === 'string' ? call[0] : call[0]?.url ?? '').includes('/api/session/review')
    ) as any[];
    await waitFor(() => expect(reviewCall[1].signal.aborted).toBe(true));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Отменить' })).toBeNull(), { timeout: 4000 });
    // The log is the same one, ended honestly; the answer is still in the field to ask again.
    expect(screen.getByRole('log').textContent).toContain('Отменено');
    expect(screen.queryByText(/Не удалось проверить/)).toBeNull();
    expect(screen.queryByText('Всё сделано')).toBeNull();
    expect((screen.getByPlaceholderText('Вставьте ответ агента...') as HTMLTextAreaElement).value).toContain(
      'console.log("saved")'
    );
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument();
    expect(callCount(spy, '/api/session/review')).toBe(1);
  });

  it('keeps the failed request log above the form, with a way to ask again', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    mockApi(completedReview, { failCompile: true });
    render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    fireEvent.click(await screen.findByRole('button', { name: /Собрать промпт/ }));

    // The log says how it ended, in the same place it was read while it ran…
    await screen.findByRole('log');
    await waitFor(() => expect(screen.getByRole('log').textContent).toContain('Ошибка · Модель недоступна'));
    expect(screen.getByRole('log').textContent).toContain('POST /api/prompt/compile');

    // …and the form comes back with the question that can be asked again.
    expect(screen.getByPlaceholderText(/Например: добавить кнопку/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Собрать промпт/ })).toBeInTheDocument();
  });

  it('says the copy did not happen, instead of claiming it did', async () => {
    /*
     * Every button that copies used to set «Скопировано» without waiting for an answer, and in the
     * desktop shell the answer was always a refusal — the permission handler said «нет» to
     * everything, a clipboard write included. The button was then the only thing that changed.
     */
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const writeText = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    Object.assign(navigator, { clipboard: { writeText } });
    document.execCommand = vi.fn(() => false) as unknown as typeof document.execCommand;
    mockApi();

    render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(await screen.findByRole('button', { name: /Собрать промпт/ }));

    const copy = await screen.findByRole('button', { name: /Скопировать промпт/ });
    fireEvent.click(copy);

    await waitFor(() => expect(screen.getByRole('button', { name: /Не удалось/ })).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith('СОБРАННЫЙ ПРОМПТ ДЛЯ НОВИЧКА');
    expect(screen.queryByRole('button', { name: /Скопировано/ })).toBeNull();
  });

  it('hands the next attempt back as a prompt, instead of ending the loop at “build it again”', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const continuation =
      'ПРОМПТ ПРОДОЛЖЕНИЯ (Попытка 2 для 100%):\nВыполните следующее:\n1. Напишите автотесты для HungerTracker.\n2. Не переписывайте работающий код.';
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    const spy = mockApi({
      ...completedReview,
      status: 'Partially Completed',
      progressPercent: 40,
      completedCriteria: [],
      missingCriteria: ['автотесты', 'обработка граничного случая'],
      nextBestAction: 'Скопируйте промпт продолжения и вставьте его в ИИ-агента.',
      agentOutputSummary: 'Класс добавлен, тестов нет.',
      continuationPrompt: continuation
    });

    render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    fireEvent.click(await screen.findByRole('button', { name: /Собрать промпт/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Я вставил/ }));
    const answerBox = await screen.findByPlaceholderText('Вставьте ответ агента...');
    fireEvent.change(answerBox, { target: { value: '```ts\n// File: src/HungerTracker.ts\nexport class HungerTracker {}\n```\n' } });

    const reviewCalls = () =>
      spy.mock.calls.filter((call: any[]) =>
        String(typeof call[0] === 'string' ? call[0] : call[0]?.url ?? '').includes('/api/session/review')
      );

    // The first check: the verdict lists what is missing, and the way forward is a prompt built
    // from exactly that list — not a fresh prompt from the task title.
    fireEvent.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => expect(screen.getByText(/Промпт для следующей попытки/)).toBeInTheDocument(), {
      timeout: 4000
    });
    expect(screen.getByText('автотесты')).toBeInTheDocument();
    expect(screen.getByText(/ПРОМПТ ПРОДОЛЖЕНИЯ/)).toBeInTheDocument();
    // The counter on the verdict itself. The dashboard also names the attempt now (it recommends the
    // continuation of that task), so the line is matched as the whole line rather than by fragment.
    expect(
      screen.getByText(
        (_text, node) =>
          node?.tagName === 'SPAN' && /^Готовность задачи: 40% • Попытка 1$/.test((node.textContent || '').trim())
      )
    ).toBeInTheDocument();

    const firstCall = JSON.parse(String(reviewCalls()[0][1].body));
    expect(firstCall.stepNumber).toBe(1);
    expect(firstCall.previousHistory).toEqual([]);

    // Copying it is the whole of the user's part: the text that lands in the clipboard is the
    // continuation prompt itself.
    fireEvent.click(screen.getByRole('button', { name: /Скопировать промпт продолжения/ }));
    expect(writeText).toHaveBeenCalledWith(continuation);

    // The attempt that used it is judged as the second one, with the first one in hand.
    fireEvent.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => expect(reviewCalls()).toHaveLength(2), { timeout: 4000 });
    const secondCall = JSON.parse(String(reviewCalls()[1][1].body));
    expect(secondCall.stepNumber).toBe(2);
    expect(secondCall.previousHistory).toHaveLength(1);
    expect(secondCall.previousHistory[0].review.missingCriteria).toEqual(['автотесты', 'обработка граничного случая']);
    // The counter is on the verdict itself, and the card now offers the third attempt. The prompt
    // text quotes its own attempt number, so the counter is matched as the whole line.
    await waitFor(() =>
      expect(
        screen.getByText(
          (_text, node) => node?.tagName === 'SPAN' && /^Готовность задачи: 40% • Попытка 2$/.test((node.textContent || '').trim())
        )
      ).toBeInTheDocument()
    );
    expect(screen.getByText(/Промпт для следующей попытки • Попытка 3/)).toBeInTheDocument();
  });

  it('runs the folder’s own checks on the code it just wrote, and judges the answer against them', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const spy = mockApi();
    const { container } = render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    fireEvent.click(await screen.findByRole('button', { name: /Собрать промпт/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Я вставил/ }));
    const answerBox = await screen.findByPlaceholderText('Вставьте ответ агента...');
    fireEvent.change(answerBox, { target: { value: 'Готово.\n\n### src/main.ts\n```ts\nconsole.log("saved");\n```\n' } });

    // The writing button is in the answer card now — the code lands in the folder before anything
    // judges it, which is what gives the checks something real to run on.
    fireEvent.click(await screen.findByRole('button', { name: /Записать код в файлы проекта/ }));
    await waitFor(() => expect(callCount(spy, '/api/files/apply')).toBe(1), { timeout: 4000 });

    // The write is the trigger: the app runs the folder's checks itself, with no terminal involved.
    await waitFor(() => expect(callCount(spy, '/api/files/verify')).toBe(1), { timeout: 4000 });
    await waitFor(() =>
      expect(container.querySelector('[data-check-row="typecheck:tsc"]')?.getAttribute('data-check-status')).toBe(
        'failed'
      )
    );

    fireEvent.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => expect(screen.getByText('Всё сделано')).toBeInTheDocument(), { timeout: 4000 });

    // What reached the reviewer is the measured result, not a description of one: the check that
    // failed, its command, and the problems it printed.
    const reviewCall = spy.mock.calls.find((entry: any[]) =>
      String(typeof entry[0] === 'string' ? entry[0] : entry[0]?.url ?? '').includes('/api/session/review')
    );
    const body = JSON.parse(String(reviewCall[1].body));
    expect(body.checkEvidence.ok).toBe(false);
    expect(body.checkEvidence.lines[0].status).toBe('failed');
    expect(body.checkEvidence.lines[0].commandLine).toContain('tsc');

    /*
     * …and a task is not closed over a failing build. The writer of the answer was never the one who
     * decided the work was finished: for four attempts the task could be marked done at 0%, in front
     * of a red type check, which made both the verdict and the strip beside it look like decoration.
     */
    expect(screen.getByRole('button', { name: /Отметить задачу выполненной/ })).toBeDisabled();
    expect(screen.getByText(/Проверки проекта не проходят: Проверка типов/)).toBeInTheDocument();
    expect(screen.getByText('Отметить выполненной пока нельзя')).toBeInTheDocument();
  });

  it('names every reason a task cannot be closed, and closes it once they are gone', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const partialReview = {
      ...completedReview,
      status: 'Partially Completed',
      progressPercent: 40,
      completedCriteria: [],
      missingCriteria: ['обработка сохранения'],
      nextBestAction: 'Добавьте сохранение прогресса',
      continuationPrompt: 'ПРОМПТ ПРОДОЛЖЕНИЯ',
      agentOutputSummary: 'Кнопка есть, сохранения нет.'
    };

    const spy = mockApi(partialReview);
    render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    fireEvent.click(await screen.findByRole('button', { name: /Собрать промпт/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Я вставил/ }));
    fireEvent.change(await screen.findByPlaceholderText('Вставьте ответ агента...'), {
      target: { value: 'Готово.\n\n### src/main.ts\n```ts\nconsole.log("saved");\n```\n' }
    });
    // Writing is what makes the app run the folder's checks; this folder's type check fails.
    fireEvent.click(await screen.findByRole('button', { name: /Записать код в файлы проекта/ }));
    await waitFor(() => expect(callCount(spy, '/api/files/verify')).toBe(1), { timeout: 4000 });

    fireEvent.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => expect(screen.getByText('Сделано частично')).toBeInTheDocument(), { timeout: 4000 });

    const mark = screen.getByRole('button', { name: /Отметить задачу выполненной/ });
    expect(mark).toBeDisabled();
    // Both causes are named, not just "not allowed": the verdict is a partial pass and the build fails.
    expect(screen.getByText(/Агент сделал не всё/)).toBeInTheDocument();
    expect(screen.getByText(/Проверки проекта не проходят: Проверка типов/)).toBeInTheDocument();

    // Pressing it changes nothing in the project.
    fireEvent.click(mark);
    const stored = JSON.parse(localStorage.getItem('easy_project_compiler_current_project') || '{}');
    const storedTask = stored.phases?.[0]?.tasks?.[0];
    expect(storedTask?.status).not.toBe('completed');
  });

  it('closes the task when the verdict is a pass and every check passed', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    const passingVerification = {
      ...failingVerification,
      ok: true,
      passed: 1,
      failed: 0,
      problems: [],
      results: failingVerification.results.map((result) => ({
        ...result,
        status: 'passed',
        exitCode: 0,
        problems: []
      })),
      summary: { ...failingVerification.summary, ok: true, passed: 1, failed: 0, problemCount: 0, errors: 0 }
    };

    const spy = mockApi(completedReview, { verification: passingVerification });
    render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    fireEvent.click(await screen.findByRole('button', { name: /Собрать промпт/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Я вставил/ }));
    fireEvent.change(await screen.findByPlaceholderText('Вставьте ответ агента...'), {
      target: { value: 'Готово.\n\n### src/main.ts\n```ts\nconsole.log("saved");\n```\n' }
    });
    fireEvent.click(await screen.findByRole('button', { name: /Записать код в файлы проекта/ }));
    await waitFor(() => expect(callCount(spy, '/api/files/verify')).toBe(1), { timeout: 4000 });

    fireEvent.click(screen.getByRole('button', { name: /Проверить ответ/ }));
    await waitFor(() => expect(screen.getByText('Всё сделано')).toBeInTheDocument(), { timeout: 4000 });

    const mark = screen.getByRole('button', { name: /Отметить задачу выполненной/ });
    expect(mark).toBeEnabled();
    expect(screen.queryByText('Отметить выполненной пока нельзя')).toBeNull();

    fireEvent.click(mark);
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem('easy_project_compiler_current_project') || '{}');
      expect(stored.phases?.[0]?.tasks?.[0]?.status).toBe('completed');
    });
  });

  it('says out loud that a run is under way, on the screen and in the sidebar', async () => {
    const project = makeProject('Beginner / Non-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    mockApi(completedReview, { deferReview: true });
    const { container } = render(<App />);

    await waitFor(() => expect(window.location.hash).not.toBe('#/simple'), { timeout: 4000 });
    fireEvent.click(screen.getByRole('button', { name: /Пошаговый помощник/ }));
    await waitFor(() => expect(window.location.hash).toBe('#/simple'), { timeout: 4000 });

    fireEvent.click(await screen.findByRole('button', { name: /Собрать промпт/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Я вставил/ }));
    const answerBox = await screen.findByPlaceholderText('Вставьте ответ агента...');
    fireEvent.change(answerBox, { target: { value: 'Готово.\n\n### src/main.ts\n```ts\nconsole.log("saved");\n```\n' } });

    // Fourth attempt of the same task: the run has to be readable as one, not as a frozen screen.
    fireEvent.click(await screen.findByRole('button', { name: /Проверить ответ/ }));

    await waitFor(() => expect(container.querySelector('[data-session-banner]')).toBeTruthy(), { timeout: 4000 });
    await waitFor(() =>
      expect(container.querySelector('[data-session-attempt]')?.textContent).toBe('1')
    );
    expect(screen.getByText('Сессия идёт')).toBeInTheDocument();

    // The moving edge runs around the sidebar entry that leads here, not around the step card.
    const helperEntry = screen.getByRole('button', { name: /Пошаговый помощник/ });
    await waitFor(() => expect(helperEntry.getAttribute('data-helper-running')).toBe('true'));
    expect(helperEntry.className).toContain('epc-runner');
    expect(helperEntry.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[data-simple-running="true"]')?.className || '').not.toContain('epc-runner');

    releaseReview?.(completedReview);
    await waitFor(() => expect(screen.getByText('Всё сделано')).toBeInTheDocument(), { timeout: 4000 });

    // The sign goes away with the work: an indicator still blinking after the verdict is a lie.
    await waitFor(() => expect(container.querySelector('[data-session-banner]')).toBeNull());
    expect(container.querySelector('[data-session-indicator]')).toBeNull();
    await waitFor(() => expect(helperEntry.getAttribute('data-helper-running')).toBe('false'));
    expect(helperEntry.className).not.toContain('epc-runner');
    await waitFor(() => expect(container.querySelector('[data-simple-running="true"]')).toBeNull());
  });

  it('keeps the workspace folded for every other mode until the user reveals it', async () => {
    const project = makeProject('Vibe-coder');
    localStorage.setItem('easy_project_compiler_current_project', JSON.stringify(project));
    localStorage.setItem('easy_project_compiler_projects', JSON.stringify([project]));
    localStorage.setItem('easy_project_compiler_lang', 'ru');

    mockApi();

    render(<App />);

    // No redirect: the dashboard is the landing screen.
    expect(window.location.hash).not.toBe('#/simple');
    await screen.findByText('Обзор проекта');

    // The sidebar starts folded: the helper, the screen the user is on, and the reveal entry.
    expect(screen.queryByRole('button', { name: 'Компилятор промптов' })).toBeNull();
    const reveal = screen.getByRole('button', { name: /Показать все разделы/ });

    // Revealing brings every screen back…
    fireEvent.click(reveal);
    expect(await screen.findByRole('button', { name: 'Компилятор промптов' })).toBeInTheDocument();

    // …and the same entry folds the list again.
    fireEvent.click(screen.getByRole('button', { name: /Скрыть лишние разделы/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Компилятор промптов' })).toBeNull());
  });
});
