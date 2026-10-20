import type { Request, Response } from 'express';

/**
 * The live side of a compile.
 *
 * The helper screen does not wait beside a spinner: it replaces its form with a terminal, and this
 * is what writes to it. The compile keeps answering with the same JSON envelope it always did —
 * `?stream=1` adds a channel beside that answer, it does not replace it. Every frame names a real
 * event: a provider attempt, a piece of the model's own text, the finished result, or the failure.
 *
 * The stream is opened only when it is asked for. A plain `POST /api/prompt/compile` (the compiler
 * screen, every existing test) never touches `res.write`, which is what keeps this an addition
 * rather than a rewrite of the route.
 */

export type CompileFrame =
  | { type: 'attempt'; provider: string; model: string | null }
  | { type: 'delta'; text: string }
  | { type: 'result'; success: true; data: any; engine: string }
  | { type: 'error'; error: string };

export interface CompileStream {
  /** Aborted when the screen that asked for the answer disconnects. */
  readonly signal?: AbortSignal;
  attempt(provider: string, model: string | null): void;
  delta(text: string): void;
  result(payload: { success: true; data: any; engine: string }): void;
  fail(message: string): void;
}

/** Whether this request asked for the live channel rather than the plain JSON answer. */
export function wantsCompileStream(req: Request): boolean {
  const flag = String((req as any)?.query?.stream ?? '');
  if (flag === '1' || flag === 'true') return true;
  return String((req as any)?.headers?.accept ?? '').includes('text/event-stream');
}

/**
 * Opens the channel, or returns `null` when the request did not ask for it.
 *
 * A response that cannot write (a test double, a proxy) gets `null` too: the caller then answers
 * the plain way, and the request is still served.
 */
export function createCompileStream(req: Request, res: Response): CompileStream | null {
  if (!wantsCompileStream(req)) return null;
  if (typeof (res as any)?.write !== 'function' || typeof (res as any)?.setHeader !== 'function') return null;

  const controller = new AbortController();
  /** True once this stream is finished — by us, or by the reader going away. */
  let closed = false;
  /*
   * The window can be closed mid-answer: the provider request then has nobody to answer, so it is
   * aborted instead of being paid for and thrown away.
   *
   * The listener belongs to the response, not the request. `req` emits `close` as soon as its body
   * has been read — express.json() reads it before the controller runs — so listening there aborted
   * every provider call instantly and the screen silently fell back to the local engine. The
   * response's own close, with nothing written by us, is the event that means "nobody is listening".
   */
  try {
    (res as any)?.on?.('close', () => {
      if ((res as any).writableEnded) return;
      // Nobody is reading any more: stop paying for an answer, and stop writing into a dead socket.
      closed = true;
      controller.abort();
    });
  } catch {
    /* A response with no event emitter is still a response. */
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Express leaves the headers in its buffer until something is written; a browser that is waiting
  // for the first token must not wait for the first token to learn that it is a stream.
  (res as any).flushHeaders?.();

  const write = (frame: CompileFrame): void => {
    if (closed) return;
    try {
      res.write(`data: ${JSON.stringify(frame)}\n\n`);
    } catch {
      closed = true;
      controller.abort();
    }
  };

  const close = (frame: CompileFrame): void => {
    write(frame);
    if (closed) return;
    closed = true;
    try {
      res.end();
    } catch {
      /* The connection is already gone; there is nothing left to close. */
    }
  };

  return {
    signal: controller.signal,
    attempt: (provider, model) => write({ type: 'attempt', provider, model }),
    delta: (text) => {
      if (text) write({ type: 'delta', text });
    },
    result: (payload) => close({ type: 'result', ...payload }),
    fail: (message) => close({ type: 'error', error: message })
  };
}
