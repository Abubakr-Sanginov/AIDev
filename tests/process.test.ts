import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runProcess } from '../src/runtimes/process.js';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe('runProcess', () => {
  it('executes command shims by command name and preserves metacharacters as one argument', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'process-shim-'));
    directories.push(directory);
    const command = `test-shim-${process.pid}`;
    const output = 'argument & | < > % $ preserved';

    if (process.platform === 'win32') {
      await writeFile(
        path.join(directory, `${command}.cmd`),
        '@echo off\r\nnode -e "process.stdout.write(process.argv[1])" "%~1"\r\n',
      );
    } else {
      const shim = path.join(directory, command);
      await writeFile(shim, '#!/bin/sh\nnode -e \'process.stdout.write(process.argv[1])\' "$1"\n');
      await chmod(shim, 0o755);
    }

    const originalPath = process.env.PATH;
    process.env.PATH = `${directory}${path.delimiter}${originalPath ?? ''}`;
    try {
      await expect(runProcess(command, [output], directory)).resolves.toEqual({
        code: 0,
        stdout: output,
        stderr: '',
      });
    } finally {
      process.env.PATH = originalPath;
    }
  });
});
