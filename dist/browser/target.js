import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
const WEB_DEPENDENCIES = [
    'astro',
    'vite',
    'next',
    'nuxt',
    '@sveltejs/kit',
    'react-scripts',
    '@angular/cli',
    'gatsby',
    '@remix-run/dev',
    'parcel',
    'webpack-dev-server',
    '@vue/cli-service',
    '@11ty/eleventy',
];
// `dev` first: it needs no prior build, unlike `preview` and usually `start`.
const SERVE_SCRIPTS = ['dev', 'start', 'preview', 'serve'];
/**
 * `localhost` servers often listen on IPv6 `::1` only, and some machines
 * (VPN clients, firewalls) refuse IPv6 loopback connects, for browsers too.
 * When a script directly invokes a known dev server, pin it to IPv4.
 */
const HOST_FLAGS = [
    { binary: /^(?:astro|vite|nuxi?|svelte-kit)\b/, flag: '--host 127.0.0.1' },
    { binary: /^(?:next|gatsby)\b/, flag: '-H 127.0.0.1' },
];
function withHostFlag(packageManager, script, body) {
    const base = `${packageManager} run ${script}`;
    const flag = HOST_FLAGS.find((entry) => entry.binary.test(body.trim()))?.flag;
    if (flag === undefined)
        return base;
    // npm needs `--` to forward arguments; pnpm, yarn and bun forward them as-is.
    return packageManager === 'npm' ? `${base} -- ${flag}` : `${base} ${flag}`;
}
const STATIC_ENTRIES = [
    'index.html',
    'public/index.html',
    'dist/index.html',
    'build/index.html',
    'src/index.html',
];
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
async function exists(file) {
    try {
        await access(file);
        return true;
    }
    catch {
        return false;
    }
}
async function detectPackageManager(root, manifest) {
    const declared = typeof manifest.packageManager === 'string' ? manifest.packageManager : '';
    for (const candidate of ['pnpm', 'yarn', 'bun', 'npm'])
        if (declared.startsWith(`${candidate}@`))
            return candidate;
    if (await exists(path.join(root, 'pnpm-lock.yaml')))
        return 'pnpm';
    if (await exists(path.join(root, 'yarn.lock')))
        return 'yarn';
    if (await exists(path.join(root, 'bun.lockb')))
        return 'bun';
    return 'npm';
}
async function readManifest(root) {
    try {
        const parsed = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
        return isRecord(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
/** Returns undefined when the project has nothing a browser could open. */
export async function detectWebTarget(root) {
    const manifest = await readManifest(root);
    if (manifest !== undefined) {
        const dependencies = {
            ...(isRecord(manifest.dependencies) ? manifest.dependencies : {}),
            ...(isRecord(manifest.devDependencies) ? manifest.devDependencies : {}),
        };
        const scripts = isRecord(manifest.scripts) ? manifest.scripts : {};
        const script = SERVE_SCRIPTS.find((name) => typeof scripts[name] === 'string');
        if (script !== undefined && WEB_DEPENDENCIES.some((name) => name in dependencies)) {
            const packageManager = await detectPackageManager(root, manifest);
            const body = String(scripts[script]);
            return {
                kind: 'script',
                packageManager,
                script,
                command: withHostFlag(packageManager, script, body),
                // Create React App and webpack-dev-server read the bind address from HOST.
                env: /^(?:react-scripts|webpack)\b/.test(body.trim()) ? { HOST: '127.0.0.1' } : {},
                needsInstall: !(await exists(path.join(root, 'node_modules'))),
            };
        }
    }
    for (const entry of STATIC_ENTRIES)
        if (await exists(path.join(root, entry)))
            return { kind: 'static', directory: path.dirname(path.join(root, entry)) };
    return undefined;
}
// eslint-disable-next-line no-control-regex
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;
const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\])(?::\d+)?(?:\/[^\s'"`<>)]*)?/i;
/** Finds the address a dev server announces ("Local: http://localhost:4321/"). */
export function findLocalUrl(output) {
    const match = LOCAL_URL.exec(output.replace(ANSI, ''));
    if (match === null)
        return undefined;
    return match[0].replace(/\/\/(?:0\.0\.0\.0|\[::1?\])/, '//localhost').replace(/[.,;:]+$/, '');
}
/**
 * A failing check carries a real `VERDICT: FAIL` line so the tester gate routes
 * it to the fixer. A passing one deliberately does not say `VERDICT: PASS`:
 * appended to a tester artifact, that would mask the tester's own findings.
 */
export function formatBrowserReport(findings) {
    const lines = [
        '## Browser check',
        `Opened ${findings.url} in ${findings.browser} (${findings.headed ? 'visible window' : 'headless'}).`,
        `Scrolled ${findings.screens} screen(s), clicked ${findings.clicked} of ${findings.interactive} interactive element(s), typed into ${findings.typed} input(s).`,
    ];
    if (findings.defects.length > 0) {
        lines.push('', 'Defects found in the running site:');
        for (const defect of findings.defects)
            lines.push(`- ${defect}`);
    }
    if (findings.notes.length > 0) {
        lines.push('', 'Notes:');
        for (const note of findings.notes)
            lines.push(`- ${note}`);
    }
    if (findings.screenshots.length > 0)
        lines.push('', `Screenshots: ${findings.screenshots.join(', ')}`);
    lines.push('', findings.defects.length > 0 ? 'VERDICT: FAIL (browser check)' : 'Browser check: PASS');
    return lines.join('\n');
}
/** A failure before any page could be inspected (no install, server crash). */
export function formatBrowserFailure(reason) {
    return ['## Browser check', reason, '', 'VERDICT: FAIL (browser check)'].join('\n');
}
