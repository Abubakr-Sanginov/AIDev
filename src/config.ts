import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { durableWriteFile } from './durable-file.js';
import { resolveTheme } from './ui/ascii.js';

export interface CliConfig {
  runtime?: string;
  model?: string;
  approval?: string;
  theme?: string;
}

const CONFIG_KEYS = ['runtime', 'model', 'approval', 'theme'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

const APPROVAL_MODES = ['ask', 'always', 'never'];

export function configPath(root: string): string {
  return path.join(root, '.ai-dev-team', 'config.json');
}

export async function loadConfig(root: string): Promise<CliConfig> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(await readFile(configPath(root), 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    if (error instanceof SyntaxError) return {};
    throw error;
  }
  const config: CliConfig = {};
  for (const key of CONFIG_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value !== '') config[key] = value;
  }
  return config;
}

export async function setConfigValue(
  root: string,
  key: string,
  value: string,
): Promise<CliConfig> {
  if (!CONFIG_KEYS.includes(key as ConfigKey))
    throw new Error(`Unknown config key '${key}'. Available keys: ${CONFIG_KEYS.join(', ')}.`);
  if (value.trim() === '') throw new Error(`Config value for '${key}' cannot be empty.`);
  if (key === 'approval' && !APPROVAL_MODES.includes(value))
    throw new Error('approval must be ask, always, or never.');
  if (key === 'theme') resolveTheme(value);
  const next: CliConfig = { ...(await loadConfig(root)) };
  next[key as ConfigKey] = value;
  await durableWriteFile(configPath(root), JSON.stringify(next, null, 2) + '\n');
  return next;
}

export async function resetConfig(root: string): Promise<void> {
  await durableWriteFile(configPath(root), '{}\n');
}
