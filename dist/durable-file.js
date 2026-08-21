import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
const replacements = new Map();
const transientCodes = new Set(['EACCES', 'EBUSY', 'EPERM']);
const defaultFileSystem = { mkdir, open, rename, rm };
function errorCode(error) {
    return error.code;
}
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
async function syncDirectory(directory, fs) {
    let handle;
    try {
        handle = await fs.open(directory, 'r');
        await handle.sync();
    }
    catch (error) {
        // Windows does not support opening directory handles through Node. The file itself
        // has already been synced, so only ignore errors that mean directory sync is unsupported.
        if (!['EACCES', 'EISDIR', 'EPERM'].includes(errorCode(error) ?? ''))
            throw error;
    }
    finally {
        await handle?.close();
    }
}
async function retryRename(source, destination, fs, delays, sleep) {
    for (let attempt = 0;; attempt++) {
        try {
            await fs.rename(source, destination);
            return;
        }
        catch (error) {
            if (!transientCodes.has(errorCode(error) ?? '') || attempt >= delays.length)
                throw error;
            await sleep(delays[attempt] ?? 0);
        }
    }
}
async function replaceFile(temporary, target, fs, delays, sleep) {
    try {
        await retryRename(temporary, target, fs, delays, sleep);
        await syncDirectory(path.dirname(target), fs);
        return;
    }
    catch (directError) {
        if (!transientCodes.has(errorCode(directError) ?? ''))
            throw directError;
        const backup = `${target}.${process.pid}.${randomUUID()}.bak`;
        try {
            await retryRename(target, backup, fs, delays, sleep);
            try {
                await retryRename(temporary, target, fs, delays, sleep);
                await syncDirectory(path.dirname(target), fs);
            }
            catch (replacementError) {
                await retryRename(backup, target, fs, delays, sleep);
                throw new Error(`Could not replace ${target}: ${message(replacementError)}; the previous state was restored.`, { cause: replacementError });
            }
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('previous state was restored'))
                throw error;
            throw new Error(`Could not atomically replace ${target}: ${message(error)}`, {
                cause: directError,
            });
        }
        finally {
            await fs.rm(backup, { force: true });
        }
    }
}
export async function durableWriteFile(target, content, options = {}) {
    const fs = { ...defaultFileSystem, ...options.fs };
    const delays = options.retryDelays ?? [10, 25, 50, 100];
    const sleep = options.sleep ??
        ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
    let handle;
    try {
        handle = await fs.open(temporary, 'wx');
        await handle.writeFile(content, { encoding: 'utf8' });
        await handle.sync();
        await handle.close();
        handle = undefined;
        const previous = replacements.get(target) ?? Promise.resolve();
        const replacement = previous
            .catch(() => undefined)
            .then(() => replaceFile(temporary, target, fs, delays, sleep));
        replacements.set(target, replacement);
        try {
            await replacement;
        }
        finally {
            if (replacements.get(target) === replacement)
                replacements.delete(target);
        }
    }
    finally {
        await handle?.close();
        await fs.rm(temporary, { force: true });
    }
}
