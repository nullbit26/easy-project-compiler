import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  ApiKeyError,
  getActiveProvider,
  getProviderStatuses,
  initApiKeyStore,
  maskKey,
  normalizeApiKey,
  removeApiKey,
  resetApiKeyStoreForTests,
  resolveApiKey,
  saveApiKey,
  validateApiKey
} from '../../server/store/apiKeyStore';

const GEMINI_SAMPLE = 'AIzaSyA1234567890abcdefghijklmnop';
const OPENAI_SAMPLE = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123';
const ENV_VARS = [
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'NVIDIA_API_KEY',
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY'
] as const;

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epc-keys-'));
const keysFile = path.join(tempDir, 'api-keys.json');
const originalEnv: Record<string, string | undefined> = {};

function readKeysFile(): any {
  return JSON.parse(fs.readFileSync(keysFile, 'utf8'));
}

describe('API key store', () => {
  beforeEach(() => {
    for (const name of ENV_VARS) {
      originalEnv[name] = process.env[name];
      delete process.env[name];
    }
    process.env.EPC_API_KEYS_FILE = keysFile;
    if (fs.existsSync(keysFile)) fs.rmSync(keysFile);
    resetApiKeyStoreForTests();
  });

  afterEach(() => {
    for (const name of ENV_VARS) {
      if (originalEnv[name] === undefined) delete process.env[name];
      else process.env[name] = originalEnv[name];
    }
    delete process.env.EPC_API_KEYS_FILE;
  });

  it('1. Normalises messy pasted keys (quotes, Bearer prefix, whitespace, newlines)', () => {
    expect(normalizeApiKey('  "sk-proj-abc123"  ')).toBe('sk-proj-abc123');
    expect(normalizeApiKey('Bearer sk-ant-key1234567890')).toBe('sk-ant-key1234567890');
    expect(normalizeApiKey('AIzaSyA123\n4567890  abc')).toBe('AIzaSyA1234567890abc');
    expect(normalizeApiKey(null)).toBe('');
    expect(normalizeApiKey('`sk-proj-abc123`;')).toBe('sk-proj-abc123');
  });

  it('2. Rejects empty, too short and malformed keys, but only warns on an unexpected prefix', () => {
    expect(validateApiKey('openai', '')).toMatchObject({ ok: false, error: 'empty' });
    expect(validateApiKey('openai', 'sk-short')).toMatchObject({ ok: false, error: 'too_short' });
    expect(validateApiKey('openai', 'sk-proj-abc 12345678901234567890')).toMatchObject({ ok: false, error: 'bad_chars' });

    const mismatched = validateApiKey('openai', GEMINI_SAMPLE);
    expect(mismatched.ok).toBe(true);
    expect(mismatched.prefixWarning).toBe(true);

    expect(validateApiKey('openai', OPENAI_SAMPLE)).toEqual({ ok: true, prefixWarning: false });
  });

  it('3. Masks keys and never exposes the full value in the status payload', () => {
    saveApiKey('openai', OPENAI_SAMPLE);
    const status = getProviderStatuses().find((p) => p.id === 'openai')!;

    expect(status.configured).toBe(true);
    expect(status.source).toBe('app');
    expect(status.masked).toContain('••••••');
    expect(status.masked).not.toBe(OPENAI_SAMPLE);
    expect(JSON.stringify(getProviderStatuses())).not.toContain(OPENAI_SAMPLE);
    expect(maskKey('short')).toBe('••••••••');
  });

  it('4. Persists the key to a local file and reports it after a restart', () => {
    saveApiKey('gemini', GEMINI_SAMPLE);

    const stored = readKeysFile();
    expect(stored.keys.gemini).toBe(GEMINI_SAMPLE);
    expect(stored.preferredProvider).toBe('gemini');

    // Simulate a server restart: drop memory, reload from the file.
    resetApiKeyStoreForTests();
    delete process.env.GEMINI_API_KEY;
    initApiKeyStore();

    expect(resolveApiKey('gemini')).toBe(GEMINI_SAMPLE);
    expect(process.env.GEMINI_API_KEY).toBe(GEMINI_SAMPLE);
    expect(getActiveProvider()).toBe('gemini');
  });

  it('5. A key saved in the app wins over an environment variable', () => {
    process.env.OPENAI_API_KEY = 'sk-env-value-abcdefghijklmnop';
    expect(getProviderStatuses().find((p) => p.id === 'openai')).toMatchObject({
      configured: true,
      source: 'env'
    });

    saveApiKey('openai', OPENAI_SAMPLE);
    expect(resolveApiKey('openai')).toBe(OPENAI_SAMPLE);
    expect(getProviderStatuses().find((p) => p.id === 'openai')).toMatchObject({ source: 'app' });
  });

  it('6. Removing a key clears the file and falls back to the environment', () => {
    saveApiKey('anthropic', 'sk-ant-abcdefghijklmnopqrstuvwx');
    const status = removeApiKey('anthropic');

    expect(status.configured).toBe(false);
    expect(status.source).toBeNull();
    expect(readKeysFile().keys.anthropic).toBeUndefined();
    expect(resolveApiKey('anthropic')).toBeNull();
    expect(getActiveProvider()).toBeNull();
  });

  it('7. The last saved key becomes the active provider', () => {
    saveApiKey('gemini', GEMINI_SAMPLE);
    expect(getActiveProvider()).toBe('gemini');

    saveApiKey('openai', OPENAI_SAMPLE);
    expect(getActiveProvider()).toBe('openai');

    // Removing the active provider falls back to the still-configured one.
    removeApiKey('openai');
    expect(getActiveProvider()).toBe('gemini');
  });

  it('8. Throws typed errors for unusable input', () => {
    expect(() => saveApiKey('openai', '   ')).toThrow(ApiKeyError);
    expect(() => saveApiKey('openai', 'short')).toThrow(/does not look valid/i);
    expect(() => saveApiKey('nope' as any, OPENAI_SAMPLE)).toThrow(ApiKeyError);
  });

  it('9. Stores an NVIDIA NIM key like any other provider', () => {
    const nvidiaKey = 'nvapi-abcdefghijklmnopqrstuvwxyz0123456789';
    saveApiKey('nvidia', '  nvapi-abcdefghijklmnopqrstuvwxyz0123456789\n');

    const status = getProviderStatuses().find((p) => p.id === 'nvidia')!;
    expect(status).toMatchObject({ envVar: 'NVIDIA_API_KEY', configured: true, source: 'app', prefixWarning: false });
    expect(resolveApiKey('nvidia')).toBe(nvidiaKey);
    expect(readKeysFile().keys.nvidia).toBe(nvidiaKey);
    expect(getActiveProvider()).toBe('nvidia');

    removeApiKey('nvidia');
    expect(getProviderStatuses().find((p) => p.id === 'nvidia')).toMatchObject({ configured: false });
  });

  it('10. Recovers from a corrupted store file without throwing', () => {
    fs.writeFileSync(keysFile, '{{{ not json', 'utf8');
    expect(() => initApiKeyStore()).not.toThrow();
    expect(getProviderStatuses().every((p) => !p.configured)).toBe(true);
  });
  it('11. Stores OpenRouter and Groq keys beside the other providers', () => {
    const openRouterKey = 'sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789';
    const groqKey = 'gsk_abcdefghijklmnopqrstuvwxyz0123456789';

    saveApiKey('openrouter', openRouterKey);
    saveApiKey('groq', groqKey);

    expect(getProviderStatuses().find((p) => p.id === 'openrouter')).toMatchObject({
      envVar: 'OPENROUTER_API_KEY',
      configured: true,
      source: 'app',
      prefixWarning: false
    });
    expect(getProviderStatuses().find((p) => p.id === 'groq')).toMatchObject({
      envVar: 'GROQ_API_KEY',
      configured: true,
      source: 'app',
      prefixWarning: false
    });
    expect(resolveApiKey('openrouter')).toBe(openRouterKey);
    expect(resolveApiKey('groq')).toBe(groqKey);
    expect(readKeysFile().keys).toMatchObject({ openrouter: openRouterKey, groq: groqKey });
    expect(getActiveProvider()).toBe('groq');

    // A key from either host can be pasted with its own dashboard's decoration and still land.
    saveApiKey('openrouter', '  "Bearer sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789"\n');
    expect(resolveApiKey('openrouter')).toBe(openRouterKey);

    removeApiKey('groq');
    expect(getProviderStatuses().find((p) => p.id === 'groq')).toMatchObject({ configured: false });
  });

});
