import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const IGNORED = new Set([
    '.git',
    '.ai-dev-team',
    '.ai-team',
    'node_modules',
    'dist',
    'build',
    'target',
    'venv',
    '.venv',
]);
const FRONTEND_DEPENDENCIES = new Set([
    'react',
    'react-dom',
    'vue',
    '@angular/core',
    'svelte',
    'next',
    'nuxt',
    'astro',
    'vite',
]);
const BACKEND_DEPENDENCIES = new Set([
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
    '@trpc/server',
]);
async function packageSignals(root) {
    try {
        const source = await readFile(path.join(root, 'package.json'), 'utf8');
        const manifest = JSON.parse(source);
        const dependencies = new Set([
            ...Object.keys(manifest.dependencies ?? {}),
            ...Object.keys(manifest.devDependencies ?? {}),
        ]);
        return {
            frontend: [...dependencies].some((name) => FRONTEND_DEPENDENCIES.has(name)),
            backend: [...dependencies].some((name) => BACKEND_DEPENDENCIES.has(name)) ||
                dependencies.has('next'),
        };
    }
    catch {
        return { frontend: false, backend: false };
    }
}
async function projectPaths(root, limit = 500) {
    const queue = [''];
    const found = [];
    while (queue.length > 0 && found.length < limit) {
        const relative = queue.shift();
        if (relative === undefined)
            break;
        let entries;
        try {
            entries = await readdir(path.join(root, relative), { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            if (IGNORED.has(entry.name))
                continue;
            const name = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory())
                queue.push(name);
            else
                found.push(name.replaceAll('\\', '/'));
        }
    }
    return found;
}
export async function detectProjectLayers(root) {
    const [manifest, paths] = await Promise.all([packageSignals(root), projectPaths(root)]);
    const names = paths.map((name) => name.toLowerCase());
    const frontend = manifest.frontend ||
        names.some((name) => /^(app|pages|components|public|styles|web|client|frontend)\//i.test(name) ||
            /^src\/(components|pages|views|routes|app)\//i.test(name) ||
            /\.(tsx|jsx|vue|svelte)$/i.test(name));
    const backend = manifest.backend ||
        names.some((name) => /^(api|server|backend|routes|controllers|models|services|database|db)\//i.test(name) ||
            /^src\/(api|server|routes|controllers|models|services)\//i.test(name) ||
            /(^|\/)(compose\.ya?ml|pyproject\.toml|requirements\.txt|pom\.xml|build\.gradle|go\.mod|cargo\.toml)$/i.test(name));
    return { frontend, backend };
}
