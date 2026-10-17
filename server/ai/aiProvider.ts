import { GoogleGenAI } from '@google/genai';
import { getGeminiClient, safeCallGemini, resilientJsonParse } from './geminiProvider';
import { AI_MAX_OUTPUT_TOKENS, ANTHROPIC_SAFE_OUTPUT_TOKENS, isOutputLimit } from './jsonRepair';
import { ProviderId, PROVIDERS, resolveApiKey, getActiveProvider } from '../store/apiKeyStore';

/**
 * Provider-agnostic AI layer.
 *
 * The app used to talk to Gemini only, so pasting an OpenAI or Anthropic key into the
 * settings panel did nothing. This router tries every provider that has a key, ordered by
 * the provider the user configured most recently, and returns the first valid JSON answer.
 * When nothing is configured (or everything fails) it returns null and the controllers fall
 * back to their local compiler, exactly as before.
 */

const OPENAI_MODELS = ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-4.1-mini', 'gpt-4o-mini'];
const ANTHROPIC_MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-4-5', 'claude-haiku-4-5'];
// NVIDIA NIM exposes an OpenAI-compatible chat endpoint on its own host.
const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1';
// Ordered fastest-first, measured against the live host with a realistic compiler-sized prompt:
// the top two answered with a complete JSON object in ~26-28 s, while nemotron-lightning needed
// over 100 s for the same request. The previous list also named three models that the host had
// already retired (HTTP 410 / 404), and a dead model aborted the whole fallback chain.
const NVIDIA_MODELS = [
  'openai/gpt-oss-20b',
  'nvidia/nemotron-3-super-120b-a12b',
  'nvidia/nemotron-3.5-lightning-30b-a3b'
];
const GEMINI_TEST_MODELS = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite'];

/** Every provider this router can talk to, with its model candidates and endpoint. */
const PROVIDER_CHAIN: Record<'openai' | 'nvidia', { baseUrl: string; models: string[] }> = {
  openai: { baseUrl: 'https://api.openai.com/v1', models: OPENAI_MODELS },
  nvidia: { baseUrl: NVIDIA_BASE_URL, models: NVIDIA_MODELS }
};

export type FailureReason =
  | 'ok'
  | 'missing_key'
  | 'auth'
  | 'quota'
  | 'model'
  | 'network'
  | 'timeout'
  | 'invalid_response'
  | 'http';

export interface ProviderTestResult {
  ok: boolean;
  provider: ProviderId;
  reason: FailureReason;
  model?: string;
  status?: number;
  message: string;
}

interface RawResult {
  ok: boolean;
  text?: string;
  reason?: FailureReason;
  status?: number;
  message?: string;
  /**
   * The provider itself said the answer stopped at the output limit. This is the only way to tell a
   * cut-off answer from a badly written one: both arrive as text that does not parse, and only the
   * first one has a finished part worth keeping.
   */
  truncated?: boolean;
}

/**
 * The text of an OpenAI-compatible answer, and whether the model ran out of room.
 *
 * `finish_reason` is `length` exactly when the answer was cut off; `stop` and the tool-related
 * reasons all mean the model finished what it was saying.
 */
export function openAiAnswer(payload: any): { text: string; truncated: boolean } {
  const choice = payload?.choices?.[0];
  const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  return { text, truncated: isOutputLimit(choice?.finish_reason ?? choice?.finishReason) };
}

/** The same reading for Anthropic, which spells the same fact `stop_reason: max_tokens`. */
export function anthropicAnswer(body: any): { text: string; truncated: boolean } {
  const blocks = Array.isArray(body?.content) ? body.content : [];
  const text = blocks
    .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
    .map((block: any) => block.text)
    .join('\n');
  return { text, truncated: isOutputLimit(body?.stop_reason ?? body?.stopReason) };
}

let lastServedProvider: ProviderId | null = null;
let lastServedModel: string | null = null;

export function getLastAiProvider(): ProviderId | null {
  return lastServedProvider;
}

export function getLastAiModel(): string | null {
  return lastServedModel;
}

/** True when at least one provider has a usable key (from the settings panel or the environment). */
export function hasAiProvider(): boolean {
  return getActiveProvider() !== null;
}

/** The provider the user configured last — that is the one the UI advertises as active. */
export function getOrderedProviders(): ProviderId[] {
  const active = getActiveProvider();
  const configured = PROVIDERS.map((p) => p.id).filter((id) => Boolean(resolveApiKey(id)));
  if (!active) return [];
  return [active, ...configured.filter((id) => id !== active)];
}

/** Provider error messages sometimes echo a truncated key back — never let that reach the client or the log. */
function redact(message: unknown): string {
  return String(message ?? '')
    .replace(/[A-Za-z0-9_\-]{20,}/g, '***')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function markServed(provider: ProviderId, model: string | null): void {
  lastServedProvider = provider;
  lastServedModel = model;
}

async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function mapHttpFailure(status: number): FailureReason {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  // 410 Gone is how the NIM host reports a retired model, so it must move to the next candidate
  // exactly like an unknown id — otherwise one end-of-life model kills the whole fallback chain.
  if (status === 404 || status === 410) return 'model';
  return 'http';
}

/**
 * A provider that accepts the request and then goes quiet must not hold the request open:
 * without this a slow model left the UI spinning for minutes with no answer and no error.
 *
 * The limits are measured, not guessed: a real compiler-sized prompt takes ~57 s on the fastest
 * candidate, so a per-attempt cap below that throws away answers the provider was about to send.
 */
const AI_REQUEST_TIMEOUT_MS = Number(process.env.AI_REQUEST_TIMEOUT_MS) || 120000;
/** Budget shared by every candidate, so an unlucky chain cannot wait forever. */
const AI_TOTAL_BUDGET_MS = Number(process.env.AI_TOTAL_BUDGET_MS) || 150000;

function timeoutResult(limitMs: number): RawResult {
  return {
    ok: false,
    reason: 'timeout',
    message: `The provider did not answer within ${Math.round(limitMs / 1000)}s.`
  };
}

function isAbortError(err: unknown): boolean {
  return (err as any)?.name === 'AbortError' || (err as any)?.code === 'ABORT_ERR';
}

const JSON_SYSTEM_PROMPT = 'You reply with a single valid JSON object and nothing else. Do not wrap it in markdown.';

/**
 * Hosts that will not take an output-token ceiling at all.
 *
 * A refused field comes back as a 400 that names it, so the request is retried once without it and
 * the host is remembered — a model that does not accept the field must not lose the provider, and
 * the retry must not happen on every call.
 */
const hostsWithoutTokenBudget = new Set<string>();

/**
 * How strictly the host is asked to hold the answer to the schema.
 *
 * `schema` is the real thing — the host is given the shape and told to enforce it; `object` only
 * asks for valid JSON of any shape; `none` asks for nothing and leaves the parser to cope.
 */
type JsonMode = 'schema' | 'object' | 'none';

/**
 * The same shape, written the way an OpenAI-compatible host wants it.
 *
 * Three translations, each of which the live host refused before it was added ("Grammar error:
 * Invalid type: OBJECT"):
 *
 *   • `Type.OBJECT` from the Gemini SDK is the OpenAPI spelling, `"OBJECT"` — JSON Schema wants
 *     lowercase, so every `type` is lowercased;
 *   • strict mode requires every object to be closed with `additionalProperties: false`;
 *   • and every property to be listed in `required`, or the host rejects the schema rather than
 *     the answer.
 *
 * The normalizer is pure, so `tests/strictSchema.test.ts` pins it without a network call.
 */
export function toStrictJsonSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(toStrictJsonSchema);
  const next: any = { ...schema };
  if (typeof next.type === 'string') next.type = next.type.toLowerCase();
  if (next.properties && typeof next.properties === 'object') {
    const properties: Record<string, any> = {};
    for (const [key, value] of Object.entries(next.properties)) {
      properties[key] = toStrictJsonSchema(value);
    }
    next.properties = properties;
    next.additionalProperties = false;
    next.required = Object.keys(properties);
  }
  if (next.items) next.items = toStrictJsonSchema(next.items);
  return next;
}

async function requestOpenAiCompatibleText(
  apiKey: string,
  model: string,
  prompt: string,
  baseUrl: string,
  mode: JsonMode = 'object',
  schema?: any,
  timeoutMs = AI_REQUEST_TIMEOUT_MS
): Promise<RawResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body: Record<string, unknown> = {
      model,
      messages: [
        { role: 'system', content: JSON_SYSTEM_PROMPT },
        { role: 'user', content: prompt }
      ]
    };
    // The ceiling, asked for rather than assumed: left out, it is whatever the host defaults to.
    if (!hostsWithoutTokenBudget.has(baseUrl)) body.max_tokens = AI_MAX_OUTPUT_TOKENS;
    // Some hosts reject a response_format for individual models; the caller walks down to a looser
    // mode instead of losing the answer.
    if (mode === 'schema' && schema) {
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'easy_project_compiler', strict: true, schema: toStrictJsonSchema(schema) }
      };
    } else if (mode === 'object') {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorBody = await readJson(res);
      const message = errorBody?.error?.message || res.statusText;
      // A host that refuses the ceiling answers 400 and says which field it did not like: the request
      // is retried without it, once, because a missing ceiling costs less than a missing provider.
      if (res.status === 400 && /max_?tokens|max_?completion_?tokens/i.test(String(message)) && !hostsWithoutTokenBudget.has(baseUrl)) {
        hostsWithoutTokenBudget.add(baseUrl);
        console.info(`[AI Router] ${baseUrl} does not take max_tokens; asking again without it.`);
        return requestOpenAiCompatibleText(apiKey, model, prompt, baseUrl, mode, schema, timeoutMs);
      }
      return {
        ok: false,
        reason: mapHttpFailure(res.status),
        status: res.status,
        message: redact(message)
      };
    }

    const payload = await readJson(res);
    const answer = openAiAnswer(payload);
    if (!answer.text.trim()) {
      return { ok: false, reason: 'invalid_response', message: 'The model returned an empty message.' };
    }
    return { ok: true, text: answer.text, truncated: answer.truncated };
  } catch (err: any) {
    if (isAbortError(err)) return timeoutResult(timeoutMs);
    return { ok: false, reason: 'network', message: redact(err?.message || 'Network error while contacting the provider.') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * OpenAI-compatible hosts such as NVIDIA NIM.
 *
 * The schema is attempted first and the request is loosened only when the host says it cannot hold
 * the answer to it: an enforced shape is what keeps "every field required" from being advice, and a
 * host that refuses the shape is answering about the request rather than about the task.
 */
async function requestCompatibleProviderText(
  provider: 'openai' | 'nvidia',
  apiKey: string,
  model: string,
  prompt: string,
  schema?: any,
  timeoutMs = AI_REQUEST_TIMEOUT_MS
): Promise<RawResult> {
  const { baseUrl } = PROVIDER_CHAIN[provider];
  const modes: JsonMode[] = schema ? ['schema', 'object', 'none'] : ['object', 'none'];
  const deadline = Date.now() + timeoutMs;
  let last: RawResult = { ok: false, reason: 'network', message: 'No request was made.' };

  for (let index = 0; index < modes.length; index++) {
    // A retry must not double the wait on a model that never answered.
    const remaining = deadline - Date.now();
    if (index > 0 && remaining <= 5000) break;

    last = await requestOpenAiCompatibleText(
      apiKey,
      model,
      prompt,
      baseUrl,
      modes[index],
      schema,
      Math.max(5000, remaining)
    );
    if (last.ok) return last;

    const refusedTheShape =
      last.status === 400 && /response_format|json_?mode|json_?schema|schema|unsupported/i.test(last.message || '');
    if (!refusedTheShape) return last;
  }
  return last;
}

async function requestAnthropicText(
  apiKey: string,
  model: string,
  prompt: string,
  timeoutMs = AI_REQUEST_TIMEOUT_MS,
  maxTokens = AI_MAX_OUTPUT_TOKENS
): Promise<RawResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        // 8000 was the number that worked with the first model this app talked to; a change set that
        // carries whole files does not fit in it. The larger ceiling is tried first and the known-good
        // one is the fallback, so a model that refuses it still answers.
        max_tokens: maxTokens,
        system: JSON_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!res.ok) {
      const errorBody = await readJson(res);
      const message = errorBody?.error?.message || res.statusText;
      if (res.status === 400 && /max_?tokens/i.test(String(message)) && maxTokens > ANTHROPIC_SAFE_OUTPUT_TOKENS) {
        return requestAnthropicText(apiKey, model, prompt, timeoutMs, ANTHROPIC_SAFE_OUTPUT_TOKENS);
      }
      return {
        ok: false,
        reason: mapHttpFailure(res.status),
        status: res.status,
        message: redact(message)
      };
    }

    const body = await readJson(res);
    const answer = anthropicAnswer(body);
    if (!answer.text.trim()) {
      return { ok: false, reason: 'invalid_response', message: 'Anthropic returned an empty message.' };
    }
    return { ok: true, text: answer.text, truncated: answer.truncated };
  } catch (err: any) {
    if (isAbortError(err)) return timeoutResult(timeoutMs);
    return { ok: false, reason: 'network', message: redact(err?.message || 'Network error while contacting Anthropic.') };
  } finally {
    clearTimeout(timer);
  }
}

async function callGeminiJson(prompt: string, responseSchema?: any): Promise<any | null> {
  const client = getGeminiClient();
  if (!client) return null;
  let usedModel: string | null = null;
  // The cut-off case is logged and repaired inside safeCallGemini, which is where the finish reason
  // is read; all this callback needs is the name of the model that answered.
  const data = await safeCallGemini(client, prompt, responseSchema, (model) => {
    usedModel = model;
  });
  if (data) {
    markServed('gemini', usedModel);
    return data;
  }
  return null;
}

async function callRestProviderJson(
  provider: 'openai' | 'anthropic' | 'nvidia',
  prompt: string,
  responseSchema?: any
): Promise<any | null> {
  const apiKey = resolveApiKey(provider);
  if (!apiKey) return null;

  const deadline = Date.now() + AI_TOTAL_BUDGET_MS;
  const models = provider === 'anthropic' ? ANTHROPIC_MODELS : PROVIDER_CHAIN[provider].models;
  for (let index = 0; index < models.length; index++) {
    const model = models[index];
    const budgetLeft = deadline - Date.now();
    // Too little left to be worth starting another model: let the caller use its local engine.
    if (index > 0 && budgetLeft <= 10000) break;
    const timeoutMs = Math.max(10000, Math.min(AI_REQUEST_TIMEOUT_MS, budgetLeft));
    const raw =
      provider === 'anthropic'
        ? await requestAnthropicText(apiKey, model, prompt, timeoutMs)
        : await requestCompatibleProviderText(provider, apiKey, model, prompt, responseSchema, timeoutMs);

    if (!raw.ok) {
      // An unknown id, a retired model or a silent model are all reasons to try the next candidate.
      if (raw.reason === 'model' || raw.reason === 'timeout') continue;
      // The message is already redacted by the request helpers (a provider sometimes echoes a
      // truncated key back), and without it a failure like this one is unattributable.
      console.info(
        `[AI Router] ${provider} request failed (${raw.reason}${raw.status ? ` ${raw.status}` : ''}): ${raw.message || ''}`
      );
      break;
    }

    if (raw.truncated) {
      console.info(
        `[AI Router] ${provider} (${model}) hit its output limit; keeping the finished part of the answer.`
      );
    }
    const parsed = resilientJsonParse(raw.text || '', { repair: raw.truncated === true });
    if (parsed && typeof parsed === 'object') {
      markServed(provider, model);
      return parsed;
    }
    console.info(`[AI Router] ${provider} returned a non-JSON payload, trying the next candidate.`);
  }
  return null;
}

/**
 * Sends the prompt to the first provider with a working key and returns its parsed JSON,
 * or null when no provider could answer (the caller then uses its local fallback).
 */
export async function callAiJson(prompt: string, responseSchema?: any): Promise<any | null> {
  for (const provider of getOrderedProviders()) {
    try {
      const data =
        provider === 'gemini'
          ? await callGeminiJson(prompt, responseSchema)
          : await callRestProviderJson(provider, prompt, responseSchema);
      if (data) return data;
    } catch (err: any) {
      console.info(`[AI Router] ${provider} threw: ${redact(err?.message || err)}`);
    }
  }
  return null;
}

/** Live check for the "Test connection" button in the settings panel. */
export async function testProviderKey(provider: ProviderId): Promise<ProviderTestResult> {
  const apiKey = resolveApiKey(provider);
  if (!apiKey) {
    return {
      ok: false,
      provider,
      reason: 'missing_key',
      message: 'No API key is configured for this provider.'
    };
  }

  const probe = 'Return exactly this JSON object and nothing else: {"ok":true}';

  if (provider === 'gemini') {
    let lastFailure: ProviderTestResult = {
      ok: false,
      provider,
      reason: 'model',
      message: 'No available Gemini model answered.'
    };
    for (const model of GEMINI_TEST_MODELS) {
      try {
        const client = new GoogleGenAI({ apiKey });
        const response = await client.models.generateContent({
          model,
          contents: probe,
          config: { responseMimeType: 'application/json' }
        });
        if (response?.text) {
          markServed('gemini', model);
          return { ok: true, provider, reason: 'ok', model, message: 'Connection successful.' };
        }
        lastFailure = { ok: false, provider, reason: 'invalid_response', model, message: 'Gemini returned an empty response.' };
      } catch (err: any) {
        const status = Number(err?.status ?? err?.code ?? 0) || undefined;
        const message = redact(err?.message || err);
        lastFailure = { ok: false, provider, reason: mapHttpFailure(status || 0), status, model, message };
        if (lastFailure.reason === 'model') continue;
        break;
      }
    }
    return lastFailure;
  }

  const model = provider === 'anthropic' ? ANTHROPIC_MODELS[0] : PROVIDER_CHAIN[provider].models[0];
  const raw =
    provider === 'anthropic'
      ? await requestAnthropicText(apiKey, model, probe)
      : await requestCompatibleProviderText(provider, apiKey, model, probe, undefined);

  if (raw.ok) {
    markServed(provider, model);
    return { ok: true, provider, reason: 'ok', model, message: 'Connection successful.' };
  }
  return {
    ok: false,
    provider,
    reason: raw.reason || 'http',
    status: raw.status,
    model,
    message: raw.message || 'The provider rejected the request.'
  };
}

/** Engine label stored with each AI response so the UI can name the provider that answered. */
export function getEngineLabel(): string {
  return lastServedProvider || 'local';
}
