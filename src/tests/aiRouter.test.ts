import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'os';
import path from 'path';
import { resetApiKeyStoreForTests } from '../../server/store/apiKeyStore';
import {
  callAiJson,
  getLastAiProvider,
  getLastAiModel,
  getOrderedProviders,
  hasAiProvider,
  testProviderKey
} from '../../server/ai/aiProvider';

const ENV_VARS = ['GEMINI_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NVIDIA_API_KEY'] as const;
const originalEnv: Record<string, string | undefined> = {};

const OPENAI_KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';
const ANTHROPIC_KEY = 'sk-ant-abcdefghijklmnopqrstuvwxyz';
const NVIDIA_KEY = 'nvapi-abcdefghijklmnopqrstuvwxyz0123456789';

function jsonResponse(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 404 ? 'Not Found' : status === 401 ? 'Unauthorized' : 'OK',
    json: async () => body
  } as any;
}

describe('AI provider router', () => {
  beforeEach(() => {
    for (const name of ENV_VARS) {
      originalEnv[name] = process.env[name];
      delete process.env[name];
    }
    process.env.EPC_API_KEYS_FILE = path.join(os.tmpdir(), 'epc-router-keys.json');
    resetApiKeyStoreForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    for (const name of ENV_VARS) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
    delete process.env.EPC_API_KEYS_FILE;
  });

  it('1. Reports no provider and short-circuits when nothing is configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(hasAiProvider()).toBe(false);
    expect(getOrderedProviders()).toEqual([]);
    await expect(callAiJson('hello')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('2. Uses an OpenAI key from the environment and parses its JSON answer', async () => {
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    const fetchMock = vi.fn(async () => jsonResponse(200, { choices: [{ message: { content: '{"ok":true,"stack":"React"}' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAiJson('pick a stack');

    expect(result).toEqual({ ok: true, stack: 'React' });
    expect(getLastAiProvider()).toBe('openai');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(JSON.parse(init.body).response_format).toEqual({ type: 'json_object' });
  });

  it('3. Falls back to the next model when the first one is unavailable', async () => {
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: { message: 'model not found' } }))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: '{"ok":true}' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAiJson('hi')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getLastAiModel()).not.toBeNull();
  });

  it('4. Talks to Anthropic with the Messages API contract', async () => {
    process.env.ANTHROPIC_API_KEY = ANTHROPIC_KEY;
    const fetchMock = vi.fn(async () => jsonResponse(200, { content: [{ type: 'text', text: '```json\n{"ok":true}\n```' }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAiJson('hi')).resolves.toEqual({ ok: true });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe(ANTHROPIC_KEY);
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(init.body).max_tokens).toBeGreaterThan(0);
  });

  it('5. Calls NVIDIA NIM through its OpenAI-compatible endpoint', async () => {
    process.env.NVIDIA_API_KEY = NVIDIA_KEY;
    const fetchMock = vi.fn(async () => jsonResponse(200, { choices: [{ message: { content: '{"ok":true,"stack":"NIM"}' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAiJson('pick a stack')).resolves.toEqual({ ok: true, stack: 'NIM' });
    expect(getLastAiProvider()).toBe('nvidia');

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe(`Bearer ${NVIDIA_KEY}`);
    expect(JSON.parse(init.body).model).toMatch(/^(nvidia|meta|openai|deepseek)\//);
  });

  it('5b. Retries NVIDIA without json mode when the model rejects response_format', async () => {
    process.env.NVIDIA_API_KEY = NVIDIA_KEY;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(400, { error: { message: 'response_format is unsupported for this model' } }))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: '{"ok":true}' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAiJson('hi')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse((fetchMock.mock.calls[1] as any)[1].body).response_format).toBeUndefined();
  });

  it('6. Returns null on an auth failure and reports the reason without leaking the key', async () => {
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { error: { message: `Incorrect API key provided: ${OPENAI_KEY}` } }))
    );

    await expect(callAiJson('hi')).resolves.toBeNull();

    const test = await testProviderKey('openai');
    expect(test.ok).toBe(false);
    expect(test.reason).toBe('auth');
    expect(test.message).not.toContain(OPENAI_KEY);
    expect(test.message).not.toContain('sk-proj');
  });

  it('7. Reports a missing key without calling the provider', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const test = await testProviderKey('openai');
    expect(test.reason).toBe('missing_key');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('8. Confirms a working connection and names the model that answered', async () => {
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { choices: [{ message: { content: '{"ok":true}' } }] })));

    const test = await testProviderKey('openai');
    expect(test.ok).toBe(true);
    expect(test.reason).toBe('ok');
    expect(test.model).toBeTruthy();
  });

  it('9b. Moves to the next candidate when NIM reports a retired model (410 Gone)', async () => {
    process.env.NVIDIA_API_KEY = NVIDIA_KEY;
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(410, { error: { message: "The model 'meta/llama-3.3-70b-instruct' has reached its end of life" } }))
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: '{"ok":true,"engine":"next"}' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAiJson('pick a stack')).resolves.toEqual({ ok: true, engine: 'next' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('9c. Moves to the next candidate when a model aborts the request', async () => {
    process.env.NVIDIA_API_KEY = NVIDIA_KEY;
    const abortError = Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abortError)
      .mockResolvedValueOnce(jsonResponse(200, { choices: [{ message: { content: '{"ok":true}' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(callAiJson('hi')).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('9d. Gives up on a provider that never answers instead of hanging forever', async () => {
    process.env.OPENAI_API_KEY = OPENAI_KEY;
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: any, init: any) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const pending = callAiJson('hi');
    // Candidates share one overall budget, then the router falls back to the local engine
    // instead of waiting on the provider forever.
    await vi.advanceTimersByTimeAsync(300000);

    await expect(pending).resolves.toBeNull();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('9. Tests an NVIDIA key against the NIM host', async () => {
    process.env.NVIDIA_API_KEY = NVIDIA_KEY;
    const fetchMock = vi.fn(async () => jsonResponse(200, { choices: [{ message: { content: '{"ok":true}' } }] }));
    vi.stubGlobal('fetch', fetchMock);

    const test = await testProviderKey('nvidia');
    expect(test.ok).toBe(true);
    expect((fetchMock.mock.calls[0] as any)[0]).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
  });
});
