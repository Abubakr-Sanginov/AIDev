import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

export const PROJECT_CONTEXT_VERSION = 1 as const;
export interface ProjectContext {
  version: typeof PROJECT_CONTEXT_VERSION;
  targetRoot: string;
  existingProject: boolean;
  truncated: boolean;
  inspectedEntries: number;
  manifests: string[];
  scripts: string[];
  packageManager?: string;
  lockfiles: string[];
  languages: string[];
  buildConfigs: string[];
  testConfigs: string[];
  lintConfigs: string[];
  formatConfigs: string[];
  instructionDocs: string[];
  topLevelTree: string[];
  representativeSourcePaths: string[];
  representativeTestPaths: string[];
  layers: { frontend: boolean; backend: boolean };
}
export interface InspectProjectOptions {
  maxEntries?: number;
  maxDepth?: number;
  maxPathsPerCategory?: number;
  maxManifestBytes?: number;
}

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.ai-dev-team',
  '.ai-team',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.yarn',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  'target',
  'out',
  'generated',
  'tmp',
  'temp',
  'venv',
  '.venv',
  '__pycache__',
]);
const SECRET_FILE =
  /(^|\/)(\.env(?:\..*)?|.*(?:credentials?|secrets?|private[-_.]?key).*|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|p12|pfx|key|keystore))$/i;
const MANIFEST =
  /(^|\/)(package\.json|pyproject\.toml|requirements(?:-[^/]+)?\.txt|pom\.xml|build\.gradle(?:\.kts)?|go\.mod|cargo\.toml|composer\.json|gemfile|mix\.exs|pubspec\.yaml)$/i;
const LOCKFILE =
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|poetry\.lock|pipfile\.lock|cargo\.lock|composer\.lock|gemfile\.lock)$/i;
const BUILD_CONFIG =
  /(^|\/)(tsconfig(?:\.[^/]+)?\.json|vite\.config\.[^/]+|webpack\.[^/]+|rollup\.config\.[^/]+|next\.config\.[^/]+|nuxt\.config\.[^/]+|makefile|cmakelists\.txt|dockerfile|compose\.ya?ml)$/i;
const TEST_CONFIG =
  /(^|\/)(vitest\.config\.[^/]+|jest\.config\.[^/]+|playwright\.config\.[^/]+|cypress\.config\.[^/]+|pytest\.ini|tox\.ini|phpunit\.xml|.*\.test\.[^/]+|.*\.spec\.[^/]+)$/i;
const LINT_CONFIG =
  /(^|\/)(eslint\.config\.[^/]+|\.eslintrc(?:\.[^/]+)?|biome\.jsonc?|ruff\.toml|\.ruff\.toml|pylintrc|golangci\.ya?ml|checkstyle\.xml)$/i;
const FORMAT_CONFIG =
  /(^|\/)(\.prettierrc(?:\.[^/]+)?|prettier\.config\.[^/]+|\.editorconfig|biome\.jsonc?|rustfmt\.toml|\.clang-format)$/i;
const INSTRUCTIONS =
  /(^|\/)(agents\.md|claude\.md|copilot-instructions\.md|contributing\.md|readme\.md|development\.md|docs\/[^/]*(?:contribut|develop|architect|style)[^/]*\.md)$/i;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e)(\/|$)|\.(?:test|spec)\.[^/]+$/i;
const SOURCE_PATH = /(^|\/)(src|app|lib|packages|apps|server|client|frontend|backend|api)(\/|$)/i;
const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.kts': 'Kotlin',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.swift': 'Swift',
  '.c': 'C',
  '.h': 'C/C++',
  '.cc': 'C++',
  '.cpp': 'C++',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.dart': 'Dart',
};

export async function validateProjectRoot(root: string): Promise<string> {
  const resolved = path.resolve(root);
  let stats;
  try {
    stats = await lstat(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error(`Project directory does not exist: ${resolved}`);
    throw error;
  }
  if (!stats.isDirectory()) throw new Error(`Project path is not a directory: ${resolved}`);
  return resolved;
}
function sorted(values: Iterable<string>, limit: number): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en')).slice(0, limit);
}

export async function inspectProject(
  root: string,
  options: InspectProjectOptions = {},
): Promise<ProjectContext> {
  const targetRoot = await validateProjectRoot(root);
  const maxEntries = Math.max(1, options.maxEntries ?? 500);
  const maxDepth = Math.max(0, options.maxDepth ?? 5);
  const maxPaths = Math.max(1, options.maxPathsPerCategory ?? 30);
  const maxManifestBytes = Math.max(1, options.maxManifestBytes ?? 128_000);
  const queue: Array<{ relative: string; depth: number }> = [{ relative: '', depth: 0 }];
  const files: string[] = [];
  const directories: string[] = [];
  let inspectedEntries = 0;
  let truncated = false;
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    let entries;
    try {
      entries = await readdir(path.join(targetRoot, current.relative), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      if (inspectedEntries >= maxEntries) {
        truncated = true;
        queue.length = 0;
        break;
      }
      inspectedEntries += 1;
      const relative = (
        current.relative ? `${current.relative}/${entry.name}` : entry.name
      ).replaceAll('\\', '/');
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        directories.push(relative);
        if (current.depth < maxDepth) queue.push({ relative, depth: current.depth + 1 });
        else truncated = true;
      } else if (entry.isFile() && !SECRET_FILE.test(relative)) files.push(relative);
    }
  }
  const packageJson = files.find((file) => file.toLowerCase() === 'package.json');
  let packageData: {
    scripts?: Record<string, unknown>;
    packageManager?: unknown;
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
  } = {};
  if (packageJson) {
    try {
      const source = await readFile(path.join(targetRoot, packageJson), 'utf8');
      if (Buffer.byteLength(source) <= maxManifestBytes)
        packageData = JSON.parse(source) as typeof packageData;
    } catch {
      /* Invalid manifests do not invalidate the inventory. */
    }
  }
  const lockfiles = sorted(
    files.filter((file) => LOCKFILE.test(file)),
    maxPaths,
  );
  const packageManagerField =
    typeof packageData.packageManager === 'string' ? packageData.packageManager : undefined;
  const packageManager =
    packageManagerField?.split('@')[0] ??
    (lockfiles.some((file) => /pnpm-lock\.yaml$/i.test(file))
      ? 'pnpm'
      : lockfiles.some((file) => /yarn\.lock$/i.test(file))
        ? 'yarn'
        : lockfiles.some((file) => /bun\.lockb?$/i.test(file))
          ? 'bun'
          : lockfiles.some((file) => /(?:package-lock|npm-shrinkwrap)\.json$/i.test(file))
            ? 'npm'
            : undefined);
  const languages = sorted(
    files
      .map((file) => LANGUAGE_BY_EXTENSION[path.extname(file).toLowerCase()])
      .filter((value): value is string => value !== undefined),
    maxPaths,
  );
  const dependencies = new Set([
    ...Object.keys(packageData.dependencies ?? {}),
    ...Object.keys(packageData.devDependencies ?? {}),
  ]);
  const names = files.map((file) => file.toLowerCase());
  const frontend =
    [...dependencies].some((name) =>
      [
        'react',
        'react-dom',
        'vue',
        '@angular/core',
        'svelte',
        'next',
        'nuxt',
        'astro',
        'vite',
      ].includes(name),
    ) ||
    names.some(
      (name) =>
        /^(src\/)?(app|pages|components|views|client|frontend)\//.test(name) ||
        /\.(tsx|jsx|vue|svelte)$/.test(name),
    );
  const backend =
    [...dependencies].some((name) =>
      [
        'express',
        'fastify',
        '@nestjs/core',
        'koa',
        'hapi',
        'prisma',
        '@prisma/client',
        'typeorm',
        'sequelize',
        'mongoose',
        'next',
      ].includes(name),
    ) ||
    names.some(
      (name) =>
        /^(src\/)?(api|server|backend|routes|controllers|services|database|db)\//.test(name) ||
        /(^|\/)(go\.mod|cargo\.toml|pom\.xml|pyproject\.toml)$/.test(name),
    );
  return {
    version: PROJECT_CONTEXT_VERSION,
    targetRoot,
    existingProject: [...directories, ...files].length > 0,
    truncated,
    inspectedEntries,
    manifests: sorted(
      files.filter((file) => MANIFEST.test(file)),
      maxPaths,
    ),
    scripts: sorted(Object.keys(packageData.scripts ?? {}), maxPaths),
    ...(packageManager === undefined ? {} : { packageManager }),
    lockfiles,
    languages,
    buildConfigs: sorted(
      files.filter((file) => BUILD_CONFIG.test(file)),
      maxPaths,
    ),
    testConfigs: sorted(
      files.filter((file) => TEST_CONFIG.test(file)),
      maxPaths,
    ),
    lintConfigs: sorted(
      files.filter((file) => LINT_CONFIG.test(file)),
      maxPaths,
    ),
    formatConfigs: sorted(
      files.filter((file) => FORMAT_CONFIG.test(file)),
      maxPaths,
    ),
    instructionDocs: sorted(
      files.filter((file) => INSTRUCTIONS.test(file)),
      maxPaths,
    ),
    topLevelTree: sorted(
      [...directories, ...files].filter((name) => name.split('/').length <= 2),
      maxPaths,
    ),
    representativeSourcePaths: sorted(
      files.filter((file) => SOURCE_PATH.test(file) && !TEST_PATH.test(file)),
      maxPaths,
    ),
    representativeTestPaths: sorted(
      files.filter((file) => TEST_PATH.test(file)),
      maxPaths,
    ),
    layers: { frontend, backend },
  };
}

export function formatProjectContext(context: ProjectContext, maxCharacters = 12_000): string {
  const line = (label: string, values: string[]): string =>
    `${label}: ${values.length ? values.join(', ') : 'none'}`;
  const summary = [
    `ProjectContext v${context.version}`,
    `targetRoot: ${context.targetRoot}`,
    `existingProject: ${context.existingProject}`,
    `inventory: ${context.inspectedEntries} entries${context.truncated ? ' (truncated by safety limits)' : ''}`,
    line('manifests', context.manifests),
    line('scripts', context.scripts),
    `packageManager: ${context.packageManager ?? 'unknown'}`,
    line('lockfiles', context.lockfiles),
    line('languages', context.languages),
    line('buildConfigs', context.buildConfigs),
    line('testConfigs', context.testConfigs),
    line('lintConfigs', context.lintConfigs),
    line('formatConfigs', context.formatConfigs),
    line('instructionDocs', context.instructionDocs),
    line('topLevelTree', context.topLevelTree),
    line('representativeSourcePaths', context.representativeSourcePaths),
    line('representativeTestPaths', context.representativeTestPaths),
    `layers: frontend=${context.layers.frontend}, backend=${context.layers.backend}`,
  ].join('\n');
  return summary.length <= maxCharacters
    ? summary
    : `${summary.slice(0, Math.max(0, maxCharacters - 14))}\n[truncated]`;
}
