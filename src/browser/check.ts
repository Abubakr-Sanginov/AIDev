import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, stat } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { Browser, Page } from 'playwright-core';
import {
  detectWebTarget,
  findLocalUrl,
  formatBrowserFailure,
  formatBrowserReport,
  type BrowserFindings,
  type WebTarget,
} from './target.js';

export interface BrowserCheckOptions {
  root: string;
  /** Show the browser window so the user can watch it click through the site. */
  headed: boolean;
  onActivity?: (message: string) => void;
  serverTimeoutMs?: number;
  /** Upper bound for the whole exploration once the page is open. */
  explorationTimeoutMs?: number;
  maxClicks?: number;
}

export interface BrowserCheckResult {
  status: 'pass' | 'fail' | 'skipped';
  report: string;
}

interface RunningServer {
  url: string;
  stop(): Promise<void>;
}

const OUTPUT_LIMIT = 20_000;

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // The shell wrapper's children (node, esbuild, ...) survive child.kill().
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

function loopbackVariants(url: string): string[] {
  const variants = [url];
  for (const host of ['127.0.0.1', '[::1]', 'localhost'])
    variants.push(url.replace(/\/\/(?:localhost|127\.0\.0\.1|\[::1\])/, `//${host}`));
  return [...new Set(variants)];
}

/**
 * Waits until the announced address answers, trying every loopback spelling:
 * servers bound to `localhost` may listen on IPv6 only, and some machines
 * refuse Node's IPv6 loopback connects (EACCES) while browsers get through.
 * Best effort by design: the browser's own navigation is the real verdict.
 */
async function waitUntilReachable(url: string, timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  const variants = loopbackVariants(url);
  while (Date.now() < deadline) {
    for (const candidate of variants) {
      try {
        await fetch(candidate, { signal: AbortSignal.timeout(3_000) });
        return candidate;
      } catch {
        // Try the next spelling.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return url;
}

async function startScriptServer(
  root: string,
  command: string,
  extraEnv: Record<string, string>,
  timeoutMs: number,
): Promise<RunningServer> {
  const child = spawn(command, {
    cwd: root,
    shell: true,
    windowsHide: true,
    detached: process.platform !== 'win32',
    // BROWSER=none stops CRA/Vite from opening a tab of their own.
    env: { ...process.env, BROWSER: 'none', NO_COLOR: '1', FORCE_COLOR: '0', ...extraEnv },
  });
  let output = '';
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`\`${command}\` announced no local URL within ${timeoutMs}ms.`));
    }, timeoutMs);
    const onData = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-OUTPUT_LIMIT);
      const found = findLocalUrl(output);
      if (found !== undefined) {
        clearTimeout(timer);
        resolve(found);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`\`${command}\` exited with code ${code ?? 'unknown'} before serving.`));
    });
  }).catch((error: unknown) => {
    killTree(child);
    const tail = output.trim().split('\n').slice(-15).join('\n');
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${tail === '' ? '' : `\nServer output:\n${tail}`}`,
    );
  });
  const reachable = await waitUntilReachable(url, 15_000);
  return {
    url: reachable,
    stop: async () => killTree(child),
  };
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

/** A plain static site has no dev server; serve its directory read-only. */
async function startStaticServer(directory: string): Promise<RunningServer> {
  const base = path.resolve(directory);
  const server: Server = createServer((request, response) => {
    void (async () => {
      try {
        const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
        let file = path.resolve(base, `.${pathname}`);
        if (file !== base && !file.startsWith(base + path.sep)) {
          response.writeHead(403).end();
          return;
        }
        if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
        await stat(file);
        response.writeHead(200, {
          'content-type':
            CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        });
        createReadStream(file).pipe(response);
      } catch {
        response.writeHead(404).end();
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function startServer(
  target: WebTarget,
  root: string,
  timeoutMs: number,
): Promise<RunningServer> {
  return target.kind === 'static'
    ? startStaticServer(target.directory)
    : startScriptServer(root, target.command, target.env, timeoutMs);
}

async function launchBrowser(
  headed: boolean,
): Promise<{ browser: Browser; name: string } | undefined> {
  let chromium: typeof import('playwright-core').chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    return undefined;
  }
  const explicit = process.env.AI_DEV_TEAM_BROWSER_PATH?.trim();
  const candidates: Array<{ name: string; channel?: string; executablePath?: string }> = explicit
    ? [{ name: path.basename(explicit), executablePath: explicit }]
    : [
        { name: 'Microsoft Edge', channel: 'msedge' },
        { name: 'Google Chrome', channel: 'chrome' },
        { name: 'Chromium' },
      ];
  for (const candidate of candidates) {
    try {
      const browser = await chromium.launch({
        headless: !headed,
        // Slow enough in a visible window for a person to follow the clicks.
        ...(headed ? { slowMo: 120 } : {}),
        ...(candidate.channel === undefined ? {} : { channel: candidate.channel }),
        ...(candidate.executablePath === undefined
          ? {}
          : { executablePath: candidate.executablePath }),
      });
      return { browser, name: candidate.name };
    } catch {
      // Try the next installed browser.
    }
  }
  return undefined;
}

function stripHash(url: string): string {
  return url.replace(/#.*$/, '');
}

async function explore(
  page: Page,
  url: string,
  screenshotDir: string,
  root: string,
  maxClicks: number,
  say: (message: string) => void,
): Promise<Omit<BrowserFindings, 'browser' | 'headed'>> {
  const origin = new URL(url).origin;
  const defects = new Set<string>();
  const notes: string[] = [];
  const screenshots: string[] = [];
  const addDefect = (defect: string): void => {
    if (defects.size < 25) defects.add(defect.slice(0, 300));
  };
  page.on('pageerror', (error) => addDefect(`Uncaught exception: ${error.message}`));
  page.on('console', (message) => {
    // Resource failures are reported with their URL by the response listener.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))
      addDefect(`Console error: ${message.text()}`);
  });
  page.on('response', (response) => {
    const target = new URL(response.url());
    if (
      target.origin === origin &&
      response.status() >= 400 &&
      !target.pathname.endsWith('/favicon.ico')
    )
      addDefect(`HTTP ${response.status()} ${response.request().method()} ${target.pathname}`);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'failed';
    // Navigating away aborts in-flight requests, which is not a site defect;
    // HTTP error statuses are already reported by the response listener.
    if (
      new URL(request.url()).origin === origin &&
      !failure.includes('ERR_ABORTED') &&
      !failure.includes('ERR_HTTP_RESPONSE_CODE_FAILURE')
    )
      addDefect(`Request failed: ${new URL(request.url()).pathname} (${failure})`);
  });
  const shoot = async (name: string): Promise<void> => {
    const file = path.join(screenshotDir, `${name}.png`);
    try {
      await page.screenshot({ path: file });
      screenshots.push(path.relative(root, file).split(path.sep).join('/'));
    } catch {
      // A screenshot is evidence, not a gate.
    }
  };

  say(`Browser check: opening ${url}`);
  const response = await page.goto(url, { waitUntil: 'load', timeout: 45_000 });
  if (response !== null && !response.ok())
    addDefect(`Start page returned HTTP ${response.status()}.`);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  const hasContent = await page.evaluate(() => {
    const body = document.body as HTMLElement | null;
    if (body === null) return false;
    return body.innerText.trim().length > 0 || body.querySelector('canvas,svg,img,video') !== null;
  });
  if (!hasContent) addDefect('The page rendered nothing visible (blank page).');
  await shoot('01-top');

  say('Browser check: scrolling through the page');
  const viewportHeight = page.viewportSize()?.height ?? 800;
  let screens = 0;
  for (let step = 0; step < 30; step += 1) {
    const atBottom = await page.evaluate(
      () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2,
    );
    if (atBottom) break;
    await page.mouse.wheel(0, Math.round(viewportHeight * 0.9));
    await page.waitForTimeout(350);
    screens += 1;
    if (screens === 3) await shoot('02-middle');
  }
  await shoot('03-bottom');
  await page.evaluate(() => window.scrollTo(0, 0));

  say('Browser check: clicking interactive elements');
  const clickables = page.locator(
    'a[href], button, [role="button"], summary, input[type="button"], input[type="submit"]',
  );
  const interactive = await clickables.count();
  let clicked = 0;
  for (let index = 0; index < interactive && clicked < maxClicks; index += 1) {
    const element = clickables.nth(index);
    if (!(await element.isVisible().catch(() => false))) continue;
    const href = await element.getAttribute('href').catch(() => null);
    if (href !== null) {
      if (/^(?:mailto:|tel:|javascript:)/i.test(href)) continue;
      try {
        if (new URL(href, page.url()).origin !== origin) continue;
      } catch {
        continue;
      }
    }
    const label = await element
      .evaluate((node) =>
        (node.textContent.trim() || node.getAttribute('aria-label') || node.tagName).slice(0, 40),
      )
      .catch(() => 'element');
    const before = page.url();
    try {
      await element.click({ timeout: 3_000 });
      clicked += 1;
    } catch (error) {
      notes.push(
        `Could not click "${label}": ${(error instanceof Error ? error.message : String(error)).split('\n')[0] ?? ''}`,
      );
      continue;
    }
    await page.waitForTimeout(400);
    if (stripHash(page.url()) !== stripHash(before)) {
      await page.waitForLoadState('load').catch(() => undefined);
      await page
        .goBack({ waitUntil: 'load', timeout: 15_000 })
        .catch(() => page.goto(url, { waitUntil: 'load', timeout: 45_000 }));
    }
  }

  say('Browser check: typing into inputs');
  let typed = 0;
  const inputs = page.locator(
    'input[type="text"], input[type="search"], input:not([type]), textarea, [contenteditable="true"]',
  );
  const inputCount = await inputs.count();
  for (let index = 0; index < inputCount && typed < 3; index += 1) {
    const input = inputs.nth(index);
    if (!(await input.isVisible().catch(() => false))) continue;
    try {
      await input.click({ timeout: 3_000 });
      await page.keyboard.type('help');
      await page.keyboard.press('Enter');
      typed += 1;
      await page.waitForTimeout(500);
    } catch {
      // Not every visible field accepts focus; keep exploring.
    }
  }
  // Canvas terminals (xterm.js) read keys from a hidden textarea, so no visible
  // input exists: focus the terminal itself and type into it.
  if (typed === 0) {
    const terminal = page.locator('.xterm, [data-terminal], [class*="terminal" i]').first();
    if (await terminal.isVisible().catch(() => false)) {
      try {
        await terminal.click({ timeout: 3_000 });
        await page.keyboard.type('help');
        await page.keyboard.press('Enter');
        typed += 1;
        await page.waitForTimeout(800);
      } catch {
        notes.push('Found a terminal element but could not type into it.');
      }
    }
  }
  await shoot('04-after-interaction');
  return { url, screens, interactive, clicked, typed, defects: [...defects], notes, screenshots };
}

/**
 * Serves the site the agents built, opens it in a real browser, scrolls,
 * clicks and types like a first-time visitor, and reports runtime defects
 * (uncaught exceptions, console errors, failing requests, blank page).
 * Deterministic and model-free, so it costs no tokens.
 */
export async function runBrowserCheck(
  options: BrowserCheckOptions,
): Promise<BrowserCheckResult | undefined> {
  const target = await detectWebTarget(options.root);
  if (target === undefined) return undefined;
  const say = options.onActivity ?? (() => undefined);
  if (target.kind === 'script' && target.needsInstall)
    return {
      status: 'fail',
      report: formatBrowserFailure(
        `The site cannot start: dependencies are not installed (no node_modules). Run \`${target.packageManager} install\`.`,
      ),
    };
  say(
    target.kind === 'static'
      ? `Browser check: serving ${path.relative(options.root, target.directory) || '.'} statically`
      : `Browser check: starting \`${target.command}\``,
  );
  let server: RunningServer;
  try {
    server = await startServer(target, options.root, options.serverTimeoutMs ?? 120_000);
  } catch (error) {
    return {
      status: 'fail',
      report: formatBrowserFailure(
        `The site did not start: ${error instanceof Error ? error.message : String(error)}`,
      ),
    };
  }
  let launched: Awaited<ReturnType<typeof launchBrowser>>;
  try {
    launched = await launchBrowser(options.headed);
    if (launched === undefined)
      return {
        status: 'skipped',
        report:
          '## Browser check\nSkipped: no Chromium-based browser (Edge or Chrome) could be launched. Set AI_DEV_TEAM_BROWSER_PATH to a Chrome or Edge executable.',
      };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotDir = path.join(options.root, '.ai-dev-team', 'browser', stamp);
    await mkdir(screenshotDir, { recursive: true });
    const { browser, name } = launched;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // A hung page must not stall the workflow: closing the browser makes every
    // pending Playwright call reject, which ends the exploration.
    const budgetMs = options.explorationTimeoutMs ?? 240_000;
    // An object, so the closure's write is visible to control-flow analysis.
    const watchdog = { fired: false };
    const guard = setTimeout(() => {
      watchdog.fired = true;
      void browser.close();
    }, budgetMs);
    try {
      const findings = await explore(
        page,
        server.url,
        screenshotDir,
        options.root,
        options.maxClicks ?? 15,
        say,
      );
      const report = formatBrowserReport({ ...findings, browser: name, headed: options.headed });
      return { status: findings.defects.length > 0 ? 'fail' : 'pass', report };
    } catch (error) {
      const reason = watchdog.fired
        ? `The page did not finish the check within ${Math.round(budgetMs / 1000)}s.`
        : `The page could not be explored: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`;
      return { status: 'fail', report: formatBrowserFailure(`${reason} (${server.url})`) };
    } finally {
      clearTimeout(guard);
    }
  } finally {
    await launched?.browser.close().catch(() => undefined);
    await server.stop();
  }
}
