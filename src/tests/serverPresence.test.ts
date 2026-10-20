import { describe, it, expect, afterEach, vi } from 'vitest';
import { probeServer } from '../services/serverPresence';

/**
 * One question decides whether the window has a server behind it, and every screen's sentence
 * depends on the answer: the real server answers `/api/health` with a small JSON envelope, while a
 * page served by a bare Vite or static server answers with its own HTML — or with nothing at all.
 */

function response(overrides: Record<string, unknown>) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ status: 'ok' }),
    ...overrides
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Is the app’s server behind this page?', () => {
  it('1. says yes for the envelope the real server answers with', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      response({ json: async () => ({ status: 'ok', app: 'Easy Project Compiler', build: { id: '260101-1200-abcd' } }) })
    );

    expect(await probeServer()).toBe('present');
  });

  it('2. says no when the page itself comes back instead of an answer', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      response({
        status: 200,
        // index.html from a single-page fallback: a 200 that is not JSON.
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        }
      })
    );

    expect(await probeServer()).toBe('missing');
  });

  it('3. says no for an error status and for a server that cannot be reached', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce(response({ ok: false, status: 404 }));
    expect(await probeServer()).toBe('missing');

    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(await probeServer()).toBe('missing');
  });

  it('4. says no for a JSON answer that is not the app’s health envelope', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(response({ json: async () => ({ hello: 'there' }) }));

    expect(await probeServer()).toBe('missing');
  });
});
