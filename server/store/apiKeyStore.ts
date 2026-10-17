import fs from 'fs';
import path from 'path';

export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'nvidia';

export interface ProviderDefinition {
  id: ProviderId;
  envVar: string;
  labelRu: string;
  labelEn: string;
  keyPrefix: string;
  keyUrl: string;
  minLength: number;
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    id: 'gemini',
    envVar: 'GEMINI_API_KEY',
    labelRu: 'Google Gemini',
    labelEn: 'Google Gemini',
    keyPrefix: 'AIza',
    keyUrl: 'https://aistudio.google.com/app/apikey',
    minLength: 20
  },
  {
    id: 'openai',
    envVar: 'OPENAI_API_KEY',
    labelRu: 'OpenAI',
    labelEn: 'OpenAI',
    keyPrefix: 'sk-',
    keyUrl: 'https://platform.openai.com/api-keys',
    minLength: 20
  },
  {
    id: 'anthropic',
    envVar: 'ANTHROPIC_API_KEY',
    labelRu: 'Anthropic Claude',
    labelEn: 'Anthropic Claude',
    keyPrefix: 'sk-ant-',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    minLength: 20
  },
  {
    id: 'nvidia',
    envVar: 'NVIDIA_API_KEY',
    labelRu: 'NVIDIA NIM',
    labelEn: 'NVIDIA NIM',
    keyPrefix: 'nvapi-',
    keyUrl: 'https://build.nvidia.com/settings/api-keys',
    minLength: 20
  }
];

export type KeySource = 'app' | 'env';

export interface ProviderStatus {
  id: ProviderId;
  envVar: string;
  labelRu: string;
  labelEn: string;
  keyUrl: string;
  configured: boolean;
  source: KeySource | null;
  /** Masked preview such as `sk-a••••••4f9c` — never the full key. */
  masked: string | null;
  /** Short hint shown to the user when the stored key does not match the expected prefix. */
  prefixWarning: boolean;
}

interface StoreFileShape {
  version: 1;
  preferredProvider: ProviderId | null;
  keys: Partial<Record<ProviderId, string>>;
  updatedAt: string | null;
}

export class ApiKeyError extends Error {
  constructor(public code: 'unknown_provider' | 'empty_key' | 'invalid_key', message: string) {
    super(message);
    this.name = 'ApiKeyError';
  }
}

const EMPTY_STORE: StoreFileShape = { version: 1, preferredProvider: null, keys: {}, updatedAt: null };

/** Stored keys (from the UI) always win over environment variables — the last explicit user action. */
const storedKeys: Partial<Record<ProviderId, string>> = {};
let preferredProvider: ProviderId | null = null;

export function getStoreFilePath(): string {
  // Tests point this at a temp file so they never touch the developer's real keys.
  return process.env.EPC_API_KEYS_FILE || path.join(process.cwd(), 'data', 'api-keys.json');
}

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && PROVIDERS.some((p) => p.id === value);
}

export function getProviderDefinition(id: ProviderId): ProviderDefinition {
  const found = PROVIDERS.find((p) => p.id === id);
  if (!found) throw new ApiKeyError('unknown_provider', 'Unknown API provider.');
  return found;
}

/**
 * Users paste keys from web dashboards, where they routinely pick up surrounding
 * quotes, a `Bearer ` prefix, or a trailing newline/space. Normalise all of that away.
 */
export function normalizeApiKey(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\r\n\t]/g, '')
    .trim()
    .replace(/^["'`]+|["'`;]+$/g, '')
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '');
}

export function validateApiKey(id: ProviderId, normalizedKey: string): { ok: boolean; error?: string; prefixWarning: boolean } {
  const def = getProviderDefinition(id);
  if (!normalizedKey) return { ok: false, error: 'empty', prefixWarning: false };
  if (normalizedKey.length < def.minLength) return { ok: false, error: 'too_short', prefixWarning: false };
  if (!/^[A-Za-z0-9._\-]+$/.test(normalizedKey)) return { ok: false, error: 'bad_chars', prefixWarning: false };
  const prefixWarning = !normalizedKey.startsWith(def.keyPrefix);
  return { ok: true, prefixWarning };
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••••${key.slice(-4)}`;
}

function readStoreFile(): StoreFileShape {
  try {
    const filePath = getStoreFilePath();
    if (!fs.existsSync(filePath)) return { ...EMPTY_STORE, keys: {} };
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const keys: Partial<Record<ProviderId, string>> = {};
    if (parsed && typeof parsed === 'object' && parsed.keys && typeof parsed.keys === 'object') {
      for (const [provider, value] of Object.entries(parsed.keys)) {
        const normalized = normalizeApiKey(value);
        if (isProviderId(provider) && normalized) keys[provider] = normalized;
      }
    }
    return {
      version: 1,
      preferredProvider: isProviderId(parsed?.preferredProvider) ? parsed.preferredProvider : null,
      keys,
      updatedAt: typeof parsed?.updatedAt === 'string' ? parsed.updatedAt : null
    };
  } catch (err) {
    // A corrupted store must never break the server; fall back to environment variables.
    console.warn('[API Keys] Could not read the local key store, falling back to environment variables.');
    return { ...EMPTY_STORE, keys: {} };
  }
}

function writeStoreFile(): void {
  const filePath = getStoreFilePath();
  const payload: StoreFileShape = {
    version: 1,
    preferredProvider,
    keys: { ...storedKeys },
    updatedAt: new Date().toISOString()
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

/** Loads keys from disk into memory and exposes them to the AI providers. Called once on boot. */
export function initApiKeyStore(): void {
  const parsed = readStoreFile();
  for (const provider of PROVIDERS) {
    const stored = parsed.keys[provider.id];
    if (stored) {
      storedKeys[provider.id] = stored;
      process.env[provider.envVar] = stored;
    }
  }
  preferredProvider = parsed.preferredProvider;
}

export function resolveApiKey(id: ProviderId): string | null {
  const fromApp = storedKeys[id];
  if (fromApp) return fromApp;
  const fromEnv = getProviderDefinition(id).envVar;
  const raw = process.env[fromEnv];
  return raw && raw.trim() ? raw.trim() : null;
}

export function getActiveProvider(): ProviderId | null {
  const configured = PROVIDERS.filter((p) => Boolean(resolveApiKey(p.id))).map((p) => p.id);
  if (configured.length === 0) return null;
  if (preferredProvider && configured.includes(preferredProvider)) return preferredProvider;
  return configured[0];
}

export function getProviderStatuses(): ProviderStatus[] {
  return PROVIDERS.map((def) => {
    const fromApp = storedKeys[def.id];
    const key = resolveApiKey(def.id);
    const source: KeySource | null = fromApp ? 'app' : key ? 'env' : null;
    const validation = key ? validateApiKey(def.id, key) : null;
    return {
      id: def.id,
      envVar: def.envVar,
      labelRu: def.labelRu,
      labelEn: def.labelEn,
      keyUrl: def.keyUrl,
      configured: Boolean(key),
      source,
      masked: key ? maskKey(key) : null,
      prefixWarning: validation ? validation.prefixWarning : false
    };
  });
}

export function saveApiKey(id: ProviderId, rawKey: unknown): ProviderStatus {
  const def = getProviderDefinition(id);
  const normalized = normalizeApiKey(rawKey);
  const validation = validateApiKey(id, normalized);
  if (!validation.ok) {
    if (validation.error === 'empty') throw new ApiKeyError('empty_key', 'The API key is empty.');
    throw new ApiKeyError('invalid_key', `The ${def.labelEn} key does not look valid (${validation.error}).`);
  }
  storedKeys[id] = normalized;
  process.env[def.envVar] = normalized;
  preferredProvider = id;
  writeStoreFile();
  return getProviderStatuses().find((s) => s.id === id)!;
}

export function removeApiKey(id: ProviderId): ProviderStatus {
  const def = getProviderDefinition(id);
  const hadStoredKey = Boolean(storedKeys[id]);
  delete storedKeys[id];
  // Only drop the environment value when it came from this store, never the user's own .env.
  if (hadStoredKey) delete process.env[def.envVar];
  if (preferredProvider === id) {
    preferredProvider = PROVIDERS.find((p) => p.id !== id && Boolean(resolveApiKey(p.id)))?.id ?? null;
  }
  writeStoreFile();
  return getProviderStatuses().find((s) => s.id === id)!;
}

/** Test helper: clears in-memory state without touching the file on disk. */
export function resetApiKeyStoreForTests(): void {
  for (const provider of PROVIDERS) delete storedKeys[provider.id];
  preferredProvider = null;
}
