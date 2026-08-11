import { expect, it } from 'vitest';
import { buildCmdFallbackArgs, buildWindowsTerminalArgs } from '../src/terminal/system-launcher.js';

function decodeLast(args: string[]): string {
  return Buffer.from(args.at(-1) ?? '', 'base64').toString('utf16le');
}

it('builds a safe Windows Terminal command', () => {
  const args = buildWindowsTerminalArgs({
    cwd: 'C:\\work & safe',
    command: 'tool.exe',
    args: ['value & | < > % $', "single'quote"],
    title: 'Runtime "title"',
  });
  expect(args).toContain('-EncodedCommand');
  expect(args.join(' ')).not.toContain('value & |');
  const startScript = decodeLast(args);
  expect(startScript).toContain('-EncodedCommand');
});

it('builds the cmd.exe fallback with a persistent inner window', () => {
  const args = buildCmdFallbackArgs({
    cwd: 'C:\\work & safe',
    command: 'tool.exe',
    args: [],
    title: 'Run "Safe" & %PATH%!',
  });
  expect(args.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  const script = decodeLast(args);
  expect(script).toContain(
    '@(' +
      String.fromCharCode(39) +
      '/d' +
      String.fromCharCode(39) +
      ', ' +
      String.fromCharCode(39) +
      '/k' +
      String.fromCharCode(39),
  );
});

it('uses /c for a self-closing smoke window', () => {
  const args = buildCmdFallbackArgs({
    cwd: 'C:\\work',
    command: 'cmd.exe',
    args: ['/c', 'exit 0'],
    closeAfterExit: true,
  });
  expect(decodeLast(args)).toContain(
    '@(' +
      String.fromCharCode(39) +
      '/d' +
      String.fromCharCode(39) +
      ', ' +
      String.fromCharCode(39) +
      '/c' +
      String.fromCharCode(39),
  );
});
