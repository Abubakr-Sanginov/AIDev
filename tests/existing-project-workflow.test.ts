import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RuntimeOrchestrator } from '../src/runtimes/runtime-orchestrator.js';
import { MockRuntime } from '../src/runtimes/mock/runtime.js';
import type { AgentRequest, RuntimeResult, RuntimeSession } from '../src/runtimes/runtime.js';
const roots: string[] = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);
async function temp(prefix: string) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
class RecordingRuntime extends MockRuntime {
  calls: Array<{ session: RuntimeSession; request: AgentRequest }> = [];
  override async execute(session: RuntimeSession, request: AgentRequest): Promise<RuntimeResult> {
    this.calls.push({ session, request });
    if (!['manager', 'architect', 'tester', 'reviewer', 'fixer'].includes(session.roleId)) {
      const file = path.join(session.workingDirectory, 'src', 'counter.ts');
      await writeFile(
        file,
        (await readFile(file, 'utf8')).replace('return value;', 'return value + 1;'),
      );
    }
    return super.execute(session, request);
  }
}
async function fixture(root: string) {
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'tests'));
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'distinct-existing-project',
        scripts: { build: 'tsc', lint: 'eslint .', test: 'vitest run' },
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(root, 'src/counter.ts'),
    'export function counter(value: number) {\n  return value;\n}\n',
  );
  await writeFile(path.join(root, 'tests/counter.test.ts'), '// existing test\n');
  await writeFile(path.join(root, 'README.md'), '# Fixture\nNamed exports; two spaces.\n');
  await writeFile(path.join(root, 'tsconfig.json'), '{}\n');
  await writeFile(path.join(root, 'eslint.config.js'), 'export default [];\n');
  await writeFile(path.join(root, '.prettierrc.json'), '{}\n');
}
describe('existing project workflow', () => {
  it('inspects before Manager and updates in place in one working directory', async () => {
    const root = await temp('aidev-existing-');
    await fixture(root);
    const before = (await readdir(root)).sort();
    const runtime = new RecordingRuntime();
    const state = await new RuntimeOrchestrator({ root, runtime }).run(
      'Increment existing counter',
    );
    expect(runtime.calls[0]?.session.roleId).toBe('manager');
    expect(state.projectContext).toMatchObject({
      targetRoot: path.resolve(root),
      existingProject: true,
      scripts: ['build', 'lint', 'test'],
    });
    expect(state.projectContext?.buildConfigs).toContain('tsconfig.json');
    expect(state.projectContext?.lintConfigs).toContain('eslint.config.js');
    expect(state.projectContext?.formatConfigs).toContain('.prettierrc.json');
    expect(state.projectContext?.instructionDocs).toContain('README.md');
    const implementer = runtime.calls.find(
      ({ session }) =>
        !['manager', 'architect', 'tester', 'reviewer', 'fixer'].includes(session.roleId),
    );
    expect(implementer).toBeDefined();
    if (!implementer) throw new Error('Expected an implementer call');
    for (const roleId of ['manager', 'architect', implementer.session.roleId]) {
      const call = runtime.calls.find(({ session }) => session.roleId === roleId);
      expect(call?.session.workingDirectory).toBe(path.resolve(root));
      expect(call?.request.prompt).toContain('ProjectContext v1');
      expect(call?.request.prompt).toContain('existingProject: true');
      expect(call?.request.prompt).toMatch(/re-scaffold/i);
      expect(call?.request.prompt).toMatch(/existing project/i);
    }
    expect(await readFile(path.join(root, 'src/counter.ts'), 'utf8')).toContain(
      'return value + 1;',
    );
    expect((await readdir(root)).sort()).toEqual(before);
  });
  it('keeps empty creation flow and rejects an invalid root before Manager', async () => {
    const root = await temp('aidev-empty-');
    const creation = new RecordingRuntime();
    const state = await new RuntimeOrchestrator({ root, runtime: creation }).run('Create project');
    expect(state.projectContext?.existingProject).toBe(false);
    expect(
      creation.calls.every(({ session }) => session.workingDirectory === path.resolve(root)),
    ).toBe(true);
    const invalid = new RecordingRuntime();
    await expect(
      new RuntimeOrchestrator({ root: path.join(root, 'missing'), runtime: invalid }).run('Update'),
    ).rejects.toThrow();
    expect(invalid.calls).toHaveLength(0);
  });
});
