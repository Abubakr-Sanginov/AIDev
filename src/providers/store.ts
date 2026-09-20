import { chmod, readFile } from 'node:fs/promises';
import path from 'node:path';
import { durableWriteFile } from '../durable-file.js';
import {
  RESERVED_PROVIDER_IDS,
  findPreset,
  isProviderProtocol,
  type ProviderProtocol,
} from './catalog.js';

export { maskKey } from './mask.js';
import { maskKey } from './mask.js';

export interface StoredProvider {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  models: string[];
  apiKeyEnv?: string;
  preset?: string;
}

export interface ProviderView extends StoredProvider {
  keySource: 'env' | 'stored' | 'missing';
  maskedKey?: string;
}

export type KeyResolution =
  | { ok: true; key: string; source: 'env' | 'stored' }
  | { ok: false; reason: 'missing' | 'invalid' };

interface ProvidersFile {
  version: number;
  providers: Record<string, StoredProvider>;
}

interface SecretsFile {
  version: number;
  keys: Record<string, string>;
}

const PROVIDER_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

export function providersFilePath(root: string): string {
  return path.join(root, '.ai-dev-team', 'providers.json');
}

export function secretsFilePath(root: string): string {
  return path.join(root, '.ai-dev-team', 'secrets.json');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function parseStoredProvider(id: string, value: unknown): StoredProvider | undefined {
  if (!isRecord(value)) return undefined;
  const name = readString(value, 'name');
  const protocol = readString(value, 'protocol');
  const baseUrl = readString(value, 'baseUrl');
  if (!name || !protocol || !isProviderProtocol(protocol) || !baseUrl) return undefined;
  const modelsValue = value.models;
  const models = Array.isArray(modelsValue)
    ? modelsValue.filter((model): model is string => typeof model === 'string' && model !== '')
    : [];
  const apiKeyEnv = readString(value, 'apiKeyEnv');
  const preset = readString(value, 'preset');
  return {
    id,
    name,
    protocol,
    baseUrl,
    models,
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(preset === undefined ? {} : { preset }),
  };
}

async function readProvidersFile(root: string): Promise<ProvidersFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(providersFilePath(root), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, providers: {} };
    if (error instanceof SyntaxError) return { version: 1, providers: {} };
    throw error;
  }
  if (!isRecord(raw) || !isRecord(raw.providers)) return { version: 1, providers: {} };
  const providers: Record<string, StoredProvider> = {};
  for (const [id, value] of Object.entries(raw.providers)) {
    const provider = parseStoredProvider(id, value);
    if (provider) providers[id] = provider;
  }
  return { version: 1, providers };
}

async function readSecretsFile(root: string): Promise<SecretsFile> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(secretsFilePath(root), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, keys: {} };
    if (error instanceof SyntaxError) return { version: 1, keys: {} };
    throw error;
  }
  if (!isRecord(raw) || !isRecord(raw.keys)) return { version: 1, keys: {} };
  const keys: Record<string, string> = {};
  for (const [id, value] of Object.entries(raw.keys))
    if (typeof value === 'string' && value !== '') keys[id] = value;
  return { version: 1, keys };
}

async function writeProvidersFile(root: string, file: ProvidersFile): Promise<void> {
  await durableWriteFile(providersFilePath(root), JSON.stringify(file, null, 2) + '\n');
}

async function writeSecretsFile(root: string, file: SecretsFile): Promise<void> {
  const target = secretsFilePath(root);
  await durableWriteFile(target, JSON.stringify(file, null, 2) + '\n');
  if (process.platform === 'win32') return;
  try {
    await chmod(target, 0o600);
  } catch {
    // Best effort: a filesystem without POSIX mode support must not fail the write.
  }
}

function assertValidId(id: string): void {
  if (!PROVIDER_ID_PATTERN.test(id))
    throw new Error(
      `Invalid provider id '${id}'. Use 2-32 characters: lowercase letters, digits, dashes; must start with a letter.`,
    );
  if (RESERVED_PROVIDER_IDS.includes(id))
    throw new Error(`Provider id '${id}' is reserved for a built-in runtime.`);
}

function assertCustomDefinition(definition: {
  name: string;
  protocol: string;
  baseUrl: string;
  models: string[];
}): void {
  if (definition.name.trim() === '') throw new Error('Provider name cannot be empty.');
  if (!isProviderProtocol(definition.protocol))
    throw new Error('Provider protocol must be one of: openai, anthropic.');
  let parsed: URL;
  try {
    parsed = new URL(definition.baseUrl);
  } catch {
    throw new Error(`Provider baseUrl '${definition.baseUrl}' is not a valid URL.`);
  }
  if (
    parsed.protocol !== 'https:' &&
    parsed.hostname !== 'localhost' &&
    parsed.hostname !== '127.0.0.1'
  )
    throw new Error('Provider baseUrl must use https (http is allowed only for localhost).');
  if (definition.models.length === 0) throw new Error('Provider must list at least one model.');
}

function normalizeKey(key: string): string {
  const trimmed = key.trim();
  if (trimmed === '') throw new Error('API key cannot be empty.');
  return trimmed;
}

export async function listProviders(root: string): Promise<StoredProvider[]> {
  const file = await readProvidersFile(root);
  return Object.values(file.providers).sort((a, b) => a.id.localeCompare(b.id));
}

export async function getProvider(root: string, id: string): Promise<StoredProvider | undefined> {
  const file = await readProvidersFile(root);
  return file.providers[id];
}

async function requireProvider(root: string, id: string): Promise<StoredProvider> {
  const provider = await getProvider(root, id);
  if (!provider)
    throw new Error(`Unknown provider '${id}'. Add it with: ai-dev-team providers add`);
  return provider;
}

async function saveProvider(root: string, provider: StoredProvider, key?: string): Promise<void> {
  const file = await readProvidersFile(root);
  if (file.providers[provider.id])
    throw new Error(`Provider '${provider.id}' already exists. Remove it first to re-add.`);
  file.providers[provider.id] = provider;
  await writeProvidersFile(root, file);
  if (key !== undefined) await setKey(root, provider.id, key);
}

export async function addPreset(
  root: string,
  presetId: string,
  key?: string,
): Promise<StoredProvider> {
  const preset = findPreset(presetId);
  if (!preset)
    throw new Error(
      `Unknown preset '${presetId}'. Available presets: anthropic, openai, gemini, openrouter, groq, mistral, deepseek, xai.`,
    );
  const provider: StoredProvider = {
    id: preset.id,
    name: preset.name,
    protocol: preset.protocol,
    baseUrl: preset.baseUrl,
    models: [...preset.models],
    apiKeyEnv: preset.apiKeyEnv,
    preset: preset.id,
  };
  await saveProvider(root, provider, key);
  return provider;
}

export async function addCustom(
  root: string,
  definition: {
    id: string;
    name: string;
    protocol: string;
    baseUrl: string;
    models: string[];
    apiKeyEnv?: string;
  },
  key?: string,
): Promise<StoredProvider> {
  assertValidId(definition.id);
  assertCustomDefinition(definition);
  const protocol: ProviderProtocol = definition.protocol === 'anthropic' ? 'anthropic' : 'openai';
  const provider: StoredProvider = {
    id: definition.id,
    name: definition.name.trim(),
    protocol,
    baseUrl: definition.baseUrl.replace(/\/+$/, ''),
    models: definition.models,
    ...(definition.apiKeyEnv === undefined ? {} : { apiKeyEnv: definition.apiKeyEnv }),
  };
  await saveProvider(root, provider, key);
  return provider;
}
export async function removeProvider(root: string, id: string): Promise<void> {
  const providers = await readProvidersFile(root);
  if (!providers.providers[id]) throw new Error(`Unknown provider '${id}'.`);
  const remainingProviders = Object.fromEntries(
    Object.entries(providers.providers).filter(([key]) => key !== id),
  );
  await writeProvidersFile(root, { version: 1, providers: remainingProviders });
  const secrets = await readSecretsFile(root);
  if (secrets.keys[id] !== undefined) {
    const remainingKeys = Object.fromEntries(
      Object.entries(secrets.keys).filter(([key]) => key !== id),
    );
    await writeSecretsFile(root, { version: 1, keys: remainingKeys });
  }
}

export async function setKey(root: string, id: string, key: string): Promise<void> {
  await requireProvider(root, id);
  const secrets = await readSecretsFile(root);
  secrets.keys[id] = normalizeKey(key);
  await writeSecretsFile(root, secrets);
}

export async function resolveKey(root: string, id: string): Promise<KeyResolution> {
  const provider = await getProvider(root, id);
  if (!provider) return { ok: false, reason: 'invalid' };
  const envName = provider.apiKeyEnv;
  if (envName !== undefined) {
    const fromEnv = process.env[envName]?.trim();
    if (fromEnv) return { ok: true, key: fromEnv, source: 'env' };
  }
  const stored = (await readSecretsFile(root)).keys[id];
  if (stored !== undefined && stored.trim() !== '')
    return { ok: true, key: stored, source: 'stored' };
  return { ok: false, reason: 'missing' };
}

export async function providersView(root: string): Promise<ProviderView[]> {
  const providers = await listProviders(root);
  const views: ProviderView[] = [];
  for (const provider of providers) {
    const resolution = await resolveKey(root, provider.id);
    views.push({
      ...provider,
      keySource: resolution.ok ? resolution.source : 'missing',
      ...(resolution.ok ? { maskedKey: maskKey(resolution.key) } : {}),
    });
  }
  return views;
}

export async function testProvider(
  root: string,
  id: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ ok: boolean; message: string }> {
  const provider = await requireProvider(root, id);
  const resolution = await resolveKey(root, id);
  if (!resolution.ok)
    return {
      ok: false,
      message:
        `No API key. Run: ai-dev-team providers set-key ${id}` +
        (provider.apiKeyEnv ? ` or set ${provider.apiKeyEnv}` : ''),
    };
  const model = provider.models[0] ?? 'default';
  try {
    const response =
      provider.protocol === 'openai'
        ? await fetchImpl(`${provider.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${resolution.key}`,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
              max_tokens: 8,
            }),
          })
        : await fetchImpl(`${provider.baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': resolution.key,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model,
              max_tokens: 8,
              messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
            }),
          });
    return response.ok
      ? { ok: true, message: `${provider.name} responded (HTTP ${response.status}).` }
      : { ok: false, message: `HTTP ${response.status}: ${(await response.text()).slice(0, 300)}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

