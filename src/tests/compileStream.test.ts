import { describe, it, expect, vi } from 'vitest';

/**
 * The live compile, in three pieces: the frame grammar both ends share, the provider deltas the
 * server reads, and the route that turns all of it into one stream. The screen's own reading is
 * pinned in `simpleFlow.test.tsx`; nothing here needs a network call or a key.
 */

const provider = vi.hoisted(() => ({
  attempts: [] as Array<[string, string | null]>,
  deltas: [] as string[]
}));

vi.mock('../../server/ai/aiProvider', () => ({
  hasAiProvider: () => true,
  getEngineLabel: () => 'openrouter',
  callAiJson: async (_prompt: string, _schema: any, options: any) => {
    options?.onAttempt?.('openrouter', 'deepseek/deepseek-chat');
    provider.attempts.push(['openrouter', 'deepseek/deepseek-chat']);
    const pieces = [
      '{"taskTitle":"Живой тест","confidence":80,',
      '"includedFiles":[],"excludedFiles":[],"missingContext":[],"architectureWarnings":[],',
      '"promptText":"## Задача\\nСделать кнопку",',
      '"acceptanceCriteria":["Кнопка есть"],"tests":["npm run test"],',
      '"estimatedTokens":120,"nextBestAction":"Вставить","securityWarnings":[]}'
    ];
    for (const piece of pieces) {
      provider.deltas.push(piece);
      options?.onDelta?.(piece);
    }
    return JSON.parse(pieces.join(''));
  }
}));

import { takeSseFrames } from '../utils/sse';
import { newCompileMarks, partialPromptText } from '../utils/compileTrace';
import { compilePrompt } from '../../server/controllers/prompt.controller';
import { createCompileStream } from '../../server/utils/compileStream';

describe('SSE frames', () => {
  it('1. keeps a frame split across chunks until it is complete', () => {
    const first = takeSseFrames('data: {"type":"del');
    expect(first.frames).toEqual([]);
    expect(first.rest).toBe('data: {"type":"del');

    const second = takeSseFrames(`${first.rest}ta","text":"при"}\n\n`);
    expect(second.frames).toEqual([{ event: 'message', data: '{"type":"delta","text":"при"}' }]);
    expect(second.rest).toBe('');
  });

  it('2. reads named frames, joins multi-line data and skips comments', () => {
    const { frames } = takeSseFrames(
      ': keep-alive\n\nevent: attempt\ndata: {"provider":"openrouter",\ndata: "model":"deepseek/deepseek-chat"}\n\n'
    );
    expect(frames).toEqual([
      {
        event: 'attempt',
        data: '{"provider":"openrouter",\n"model":"deepseek/deepseek-chat"}'
      }
    ]);
  });

  it('3. accepts CRLF line endings, which is what some hosts send', () => {
    const { frames } = takeSseFrames('data: {"type":"delta","text":"ок"}\r\n\r\n');
    expect(frames).toEqual([{ event: 'message', data: '{"type":"delta","text":"ок"}' }]);
  });
});

describe('The compiler answers its own steps', () => {
  it('6. names each step once, in the order the answer reaches it', () => {
    const seen = new Set<string>();
    const first = newCompileMarks('{"taskTitle":"Кнопка","confidence":80', seen);
    expect(first.map((mark) => mark.ru)).toEqual(['называет задачу', 'оценивает уверенность']);
    for (const mark of first) seen.add(mark.key);

    const second = newCompileMarks('{"taskTitle":"Кнопка","confidence":80,"promptText":"## Задача', seen);
    expect(second.map((mark) => mark.ru)).toEqual(['пишет промпт']);
    for (const mark of second) seen.add(mark.key);

    expect(newCompileMarks('{"taskTitle":"Кнопка","confidence":80,"promptText":"## Задача', seen)).toEqual([]);
  });

  it('7. is not fooled by the same word inside the prompt text', () => {
    const marks = newCompileMarks('{"promptText":"run tests here, then the tests pass"}', new Set());
    expect(marks.map((mark) => mark.key)).not.toContain('"tests"');
  });

  it('8. reads the prompt being written out of the half-finished JSON', () => {
    expect(partialPromptText('{"taskTitle":"Кнопка","includedFiles":[]')).toBeNull();
    expect(partialPromptText('{"promptText":"## Задача\\nСделать кнопку')).toBe('## Задача\nСделать кнопку');
    expect(
      partialPromptText('{"promptText":"## Задача\\n\\"Кнопка\\" — по центру","tests":[]}')
    ).toBe('## Задача\n"Кнопка" — по центру');
    expect(partialPromptText('{"promptText": "line one\\nline two"}')).toBe('line one\nline two');
  });
});

describe('The live channel', () => {
  it('10. stops the provider and stops writing when the reader cancels', () => {
    let onClose: (() => void) | null = null;
    const writes: string[] = [];
    const res: any = {
      status: () => res,
      setHeader: () => res,
      flushHeaders: () => {},
      write: (chunk: string) => writes.push(chunk),
      end: () => {},
      on: (event: string, callback: () => void) => {
        if (event === 'close') onClose = callback;
      }
    };
    const stream = createCompileStream({ query: { stream: '1' }, headers: {} } as any, res);
    expect(stream).not.toBeNull();

    stream!.delta('first');
    expect(writes).toHaveLength(1);

    // The reader closed the tab or pressed «Отменить»: the provider request is aborted and the
    // socket is not written to again.
    onClose?.();
    expect(stream!.signal?.aborted).toBe(true);

    stream!.delta('second');
    expect(writes).toHaveLength(1);
  });
});

describe('POST /api/prompt/compile?stream=1', () => {
  const body = {
    userRequest: 'Добавить удаление записи',
    taskTitle: 'Удаление записи',
    projectMap: {
      projectName: 'Заметки',
      projectType: 'React',
      engineOrFramework: 'React 19 + Vite',
      language: 'TypeScript',
      files: [{ path: 'src/App.tsx', type: 'code', description: 'Главный экран' }]
    },
    agent: 'Cursor',
    contextMode: 'Balanced',
    skillLevel: 'Beginner / Non-coder',
    language: 'ru'
  };

  /** A response that keeps the frames it was written and can be closed. */
  function capture() {
    const frames: any[] = [];
    const state = { ended: false };
    const res: any = {
      status: () => res,
      setHeader: () => res,
      flushHeaders: () => {},
      write: (chunk: string) => {
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) frames.push(JSON.parse(line.slice(6)));
        }
        return true;
      },
      end: () => {
        state.ended = true;
      },
      json: () => {
        throw new Error('a streaming compile must not answer with a JSON envelope');
      }
    };
    return { res, frames, state };
  }

  it('8. reports the attempt, the model text as it arrives, and the finished prompt', async () => {
    provider.deltas.length = 0;
    const { res, frames, state } = capture();
    const req: any = {
      body,
      query: { stream: '1' },
      headers: { accept: 'text/event-stream' },
      on: () => {}
    };

    await compilePrompt(req, res);

    const attempts = frames.filter((frame) => frame.type === 'attempt');
    expect(attempts).toEqual([{ type: 'attempt', provider: 'openrouter', model: 'deepseek/deepseek-chat' }]);

    const streamed = frames
      .filter((frame) => frame.type === 'delta')
      .map((frame) => frame.text)
      .join('');
    expect(streamed).toBe(provider.deltas.join(''));
    expect(JSON.parse(streamed).taskTitle).toBe('Живой тест');

    const result = frames[frames.length - 1];
    expect(result.type).toBe('result');
    expect(result.success).toBe(true);
    expect(result.engine).toBe('openrouter');
    // The prompt the model wrote is completed from the same facts the plain route uses.
    expect(result.data.promptText).toContain('Добавить удаление записи');
    expect(result.data.taskTitle).toBe('Живой тест');
    expect(state.ended).toBe(true);
  });

  it('9. answers a plain request with JSON and writes no frames', async () => {
    const payload: any = {};
    const res: any = {
      json: (data: any) => {
        payload.body = data;
        return res;
      },
      status: () => res,
      write: () => {
        throw new Error('a plain compile must not open a stream');
      }
    };

    await compilePrompt({ body, headers: {}, on: () => {} } as any, res);

    expect(payload.body.success).toBe(true);
    expect(payload.body.engine).toBe('openrouter');
    expect(typeof payload.body.data.promptText).toBe('string');
  });
});
