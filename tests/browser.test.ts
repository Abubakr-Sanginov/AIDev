import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectWebTarget,
  findLocalUrl,
  formatBrowserFailure,
  formatBrowserReport,
  type BrowserFindings,
} from '../src/browser/target.js';

const directories: string[] = [];
async function tempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'browser-'));
  directories.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function writeManifest(root: string, manifest: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(root, 'package.json'), JSON.stringify(manifest));
}

describe('web target detection', () => {
  it('serves a framework project through its dev script with the declared package manager', async () => {
    const root = await tempRoot();
    await writeManifest(root, {
      packageManager: 'pnpm@9.15.0',
      scripts: { build: 'astro build', dev: 'astro dev', preview: 'astro preview' },
      dependencies: { astro: '^5.0.0' },
    });
    await mkdir(path.join(root, 'node_modules'));
    expect(await detectWebTarget(root)).toEqual({
      kind: 'script',
      packageManager: 'pnpm',
      script: 'dev',
      command: 'pnpm run dev --host 127.0.0.1',
      env: {},
      needsInstall: false,
    });
  });

  it('pins known dev servers to IPv4 and leaves custom scripts untouched', async () => {
    const root = await tempRoot();
    await writeManifest(root, { scripts: { dev: 'next dev' }, dependencies: { next: '15' } });
    expect(await detectWebTarget(root)).toMatchObject({ command: 'npm run dev -- -H 127.0.0.1' });
    await writeManifest(root, {
      scripts: { dev: 'concurrently "vite" "node api.js"' },
      devDependencies: { vite: '6' },
    });
    expect(await detectWebTarget(root)).toMatchObject({ command: 'npm run dev' });
    await writeManifest(root, {
      scripts: { start: 'react-scripts start' },
      dependencies: { 'react-scripts': '5' },
    });
    expect(await detectWebTarget(root)).toMatchObject({ env: { HOST: '127.0.0.1' } });
  });

  it('flags a framework project whose dependencies were never installed', async () => {
    const root = await tempRoot();
    await writeManifest(root, { scripts: { dev: 'vite' }, devDependencies: { vite: '^6.0.0' } });
    await writeFile(path.join(root, 'yarn.lock'), '');
    expect(await detectWebTarget(root)).toMatchObject({
      packageManager: 'yarn',
      needsInstall: true,
    });
  });

  it('falls back to a static index.html when there is no dev server', async () => {
    const root = await tempRoot();
    await writeManifest(root, { scripts: { lint: 'eslint .' } });
    await mkdir(path.join(root, 'public'));
    await writeFile(path.join(root, 'public', 'index.html'), '<h1>hi</h1>');
    expect(await detectWebTarget(root)).toEqual({
      kind: 'static',
      directory: path.join(root, 'public'),
    });
  });

  it('reports nothing to open for a non-web project', async () => {
    const root = await tempRoot();
    await writeManifest(root, {
      scripts: { start: 'node server.js' },
      dependencies: { express: '4' },
    });
    expect(await detectWebTarget(root)).toBeUndefined();
  });
});

describe('dev server URL discovery', () => {
  it('reads the local URL through ANSI colors', () => {
    expect(
      findLocalUrl('\u001B[32m┃ Local\u001B[39m    \u001B[1mhttp://localhost:4321/\u001B[22m\n'),
    ).toBe('http://localhost:4321/');
  });

  it('maps wildcard binds to localhost and trims trailing punctuation', () => {
    expect(findLocalUrl('Listening on http://0.0.0.0:3000.')).toBe('http://localhost:3000');
    expect(findLocalUrl('ready on http://[::]:5173/')).toBe('http://localhost:5173/');
  });

  it('ignores remote URLs', () => {
    expect(findLocalUrl('Docs: https://astro.build/docs')).toBeUndefined();
  });
});

describe('browser report', () => {
  const base: BrowserFindings = {
    url: 'http://localhost:4321/',
    browser: 'Microsoft Edge',
    headed: true,
    screens: 6,
    interactive: 14,
    clicked: 9,
    typed: 1,
    defects: [],
    notes: [],
    screenshots: ['.ai-dev-team/browser/x/01-top.png'],
  };

  it('fails with a VERDICT line so the tester gate routes it to the fixer', () => {
    const report = formatBrowserReport({
      ...base,
      defects: ['Uncaught exception: metrics is undefined'],
    });
    expect(report).toContain('- Uncaught exception: metrics is undefined');
    expect(report).toMatch(/^VERDICT: FAIL/m);
  });

  it('passes without a VERDICT line that could mask the tester findings', () => {
    const report = formatBrowserReport(base);
    expect(report).toContain('clicked 9 of 14');
    expect(report).not.toMatch(/VERDICT/);
  });

  it('fails outright when the site cannot even start', () => {
    expect(formatBrowserFailure('dependencies are not installed')).toMatch(/^VERDICT: FAIL/m);
  });
});
