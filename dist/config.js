import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { durableWriteFile } from './durable-file.js';
import { resolveTheme } from './ui/ascii.js';
const CONFIG_KEYS = ['runtime', 'model', 'approval', 'theme'];
const APPROVAL_MODES = ['ask', 'always', 'never'];
export function configPath(root) {
    return path.join(root, '.ai-dev-team', 'config.json');
}
export async function loadConfig(root) {
    let raw;
    try {
        raw = JSON.parse(await readFile(configPath(root), 'utf8'));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return {};
        if (error instanceof SyntaxError)
            return {};
        throw error;
    }
    const config = {};
    for (const key of CONFIG_KEYS) {
        const value = raw[key];
        if (typeof value === 'string' && value !== '')
            config[key] = value;
    }
    return config;
}
export async function setConfigValue(root, key, value) {
    if (!CONFIG_KEYS.includes(key))
        throw new Error(`Unknown config key '${key}'. Available keys: ${CONFIG_KEYS.join(', ')}.`);
    if (value.trim() === '')
        throw new Error(`Config value for '${key}' cannot be empty.`);
    if (key === 'approval' && !APPROVAL_MODES.includes(value))
        throw new Error('approval must be ask, always, or never.');
    if (key === 'theme')
        resolveTheme(value);
    const next = { ...(await loadConfig(root)) };
    next[key] = value;
    await durableWriteFile(configPath(root), JSON.stringify(next, null, 2) + '\n');
    return next;
}
export async function resetConfig(root) {
    await durableWriteFile(configPath(root), '{}\n');
}
