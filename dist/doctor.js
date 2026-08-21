import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { createDefaultRegistry } from './runtimes/default-registry.js';
import { runProcess } from './runtimes/process.js';
import { loadConfig } from './config.js';
function message(error) {
    return error instanceof Error ? error.message : String(error);
}
export async function runDoctor(root) {
    const checks = [];
    const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
    checks.push({
        name: 'Node.js >= 20',
        ok: nodeMajor >= 20,
        detail: `current ${process.versions.node}`,
    });
    try {
        await access(root, constants.W_OK);
        checks.push({ name: 'Project directory writable', ok: true, detail: root });
    }
    catch {
        checks.push({ name: 'Project directory writable', ok: false, detail: root });
    }
    try {
        const git = await runProcess('git', ['--version'], root, 5_000);
        checks.push({
            name: 'Git available',
            ok: git.code === 0,
            detail: git.code === 0 ? git.stdout.trim() : git.stderr.trim() || `exit code ${git.code}`,
        });
    }
    catch (error) {
        checks.push({ name: 'Git available', ok: false, detail: message(error) });
    }
    try {
        const config = await loadConfig(root);
        checks.push({
            name: 'CLI config',
            ok: true,
            detail: Object.keys(config).length > 0 ? 'loaded' : 'not configured (optional)',
        });
    }
    catch (error) {
        checks.push({ name: 'CLI config', ok: false, detail: message(error) });
    }
    for (const runtime of createDefaultRegistry().list()) {
        if (runtime.id === 'mock')
            continue;
        try {
            const detection = await runtime.detect();
            checks.push({
                name: `Runtime: ${runtime.name}`,
                ok: detection.ready,
                detail: detection.ready
                    ? `ready${detection.version ? ` (${detection.version})` : ''}`
                    : detection.installed
                        ? 'installed but not ready — authenticate it in its own CLI'
                        : 'not installed',
            });
        }
        catch (error) {
            checks.push({ name: `Runtime: ${runtime.name}`, ok: false, detail: message(error) });
        }
    }
    return checks;
}
