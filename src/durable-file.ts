import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

interface WritableHandle {
  writeFile(data: string, options: { encoding: 'utf8' }): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface DurableFileSystem {
  mkdir: typeof mkdir;
  open: (file: string, flags: string) => Promise<WritableHandle>;
  rename: typeof rename;
  rm: typeof rm;
}

export interface DurableWriteOptions {
  fs?: Partial<DurableFileSystem>;
  retryDelays?: readonly number[];
  sleep?: (milliseconds: number) => Promise<void>;
}

const replacements = new Map<string, Promise<void>>();
const transientCodes = new Set(['EACCES', 'EBUSY', 'EPERM']);
const defaultFileSystem: DurableFileSystem = { mkdir, open, rename, rm };

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function syncDirectory(directory: string, fs: DurableFileSystem): Promise<void> {
  let handle: WritableHandle | undefined;
  try {
    handle = await fs.open(directory, 'r');
    await handle.sync();
  } catch (error) {
    // Windows does not support opening directory handles through Node. The file itself
    // has already been synced, so only ignore errors that mean directory sync is unsupported.
    if (!['EACCES', 'EISDIR', 'EPERM'].includes(errorCode(error) ?? '')) throw error;
  } finally {
    await handle?.close();
  }
}

async function retryRename(
  source: string,
  destination: string,
  fs: DurableFileSystem,
  delays: readonly number[],
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      if (!transientCodes.has(errorCode(error) ?? '') || attempt >= delays.length) throw error;
      await sleep(delays[attempt] ?? 0);
    }
  }
}

async function replaceFile(
  temporary: string,
  target: string,
  fs: DurableFileSystem,
  delays: readonly number[],
  sleep: (milliseconds: number) => Promise<void>,
): Promise<void> {
  try {
    await retryRename(temporary, target, fs, delays, sleep);
    await syncDirectory(path.dirname(target), fs);
    return;
  } catch (directError) {
    if (!transientCodes.has(errorCode(directError) ?? '')) throw directError;
    const backup = `${target}.${process.pid}.${randomUUID()}.bak`;
    try {
      await retryRename(target, backup, fs, delays, sleep);
      try {
        await retryRename(temporary, target, fs, delays, sleep);
        await syncDirectory(path.dirname(target), fs);
      } catch (replacementError) {
        await retryRename(backup, target, fs, delays, sleep);
        throw new Error(
          `Could not replace ${target}: ${message(replacementError)}; the previous state was restored.`,
          { cause: replacementError },
        );
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('previous state was restored'))
        throw error;
      throw new Error(`Could not atomically replace ${target}: ${message(error)}`, {
        cause: directError,
      });
    } finally {
      await fs.rm(backup, { force: true });
    }
  }
}

export async function durableWriteFile(
  target: string,
  content: string,
  options: DurableWriteOptions = {},
): Promise<void> {
  const fs: DurableFileSystem = { ...defaultFileSystem, ...options.fs };
  const delays = options.retryDelays ?? [10, 25, 50, 100];
  const sleep =
    options.sleep ??
    ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  let handle: WritableHandle | undefined;
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
    } finally {
      if (replacements.get(target) === replacement) replacements.delete(target);
    }
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}
