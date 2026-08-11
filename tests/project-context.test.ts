import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  formatProjectContext,
  inspectProject,
  validateProjectRoot,
} from '../src/project-context.js';

const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);
async function root(): Promise<string> {
  const value = await mkdtemp(path.join(tmpdir(), 'project-context-'));
  roots.push(value);
  return value;
}

describe('project context inspector', () => {
  it('detects manifests, scripts, configs, paths, package manager, languages, and layers deterministically', async () => {
    const target = await root();
    await mkdir(path.join(target, 'src', 'server'), { recursive: true });
    await mkdir(path.join(target, 'src', 'components'), { recursive: true });
    await mkdir(path.join(target, 'tests'), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(target, 'package.json'),
        JSON.stringify({
          packageManager: 'pnpm@9',
          scripts: { test: 'vitest', build: 'tsc' },
          dependencies: { react: '1', express: '1' },
        }),
      ),
      writeFile(path.join(target, 'pnpm-lock.yaml'), ''),
      writeFile(path.join(target, 'tsconfig.json'), '{}'),
      writeFile(path.join(target, 'eslint.config.js'), ''),
      writeFile(path.join(target, 'README.md'), ''),
      writeFile(path.join(target, 'src', 'server', 'api.ts'), ''),
      writeFile(path.join(target, 'src', 'components', 'App.tsx'), ''),
      writeFile(path.join(target, 'tests', 'api.test.ts'), ''),
    ]);
    const first = await inspectProject(target);
    const second = await inspectProject(target);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      existingProject: true,
      packageManager: 'pnpm',
      layers: { frontend: true, backend: true },
    });
    expect(first.scripts).toEqual(['build', 'test']);
    expect(first.languages).toContain('TypeScript');
    expect(first.representativeTestPaths).toContain('tests/api.test.ts');
    expect(formatProjectContext(first, 100).length).toBeLessThanOrEqual(100);
  });

  it('excludes secrets, ignored trees, and directory symlink targets', async () => {
    const target = await root();
    const outside = await root();
    await mkdir(path.join(target, 'node_modules', 'secret'), { recursive: true });
    await writeFile(path.join(target, '.env'), 'TOKEN=do-not-read');
    await writeFile(path.join(target, 'credentials.json'), '{}');
    await writeFile(path.join(target, 'node_modules', 'secret', 'index.ts'), '');
    await writeFile(path.join(outside, 'leaked.ts'), '');
    try {
      await symlink(outside, path.join(target, 'linked'), 'dir');
    } catch {
      /* Symlink creation may require Windows privileges. */
    }
    const context = await inspectProject(target);
    const serialized = JSON.stringify(context);
    expect(serialized).not.toMatch(/\.env|credentials|node_modules|leaked/);
  });

  it('enforces entry and depth limits', async () => {
    const target = await root();
    for (let index = 0; index < 10; index += 1)
      await writeFile(path.join(target, `file-${index}.ts`), '');
    const context = await inspectProject(target, {
      maxEntries: 3,
      maxDepth: 0,
      maxPathsPerCategory: 2,
    });
    expect(context.truncated).toBe(true);
    expect(context.inspectedEntries).toBe(3);
    expect(context.topLevelTree.length).toBeLessThanOrEqual(2);
  });

  it('rejects missing roots and files', async () => {
    const target = await root();
    const file = path.join(target, 'file.txt');
    await writeFile(file, '');
    await expect(validateProjectRoot(path.join(target, 'missing'))).rejects.toThrow(
      /does not exist/,
    );
    await expect(validateProjectRoot(file)).rejects.toThrow(/not a directory/);
  });
});
