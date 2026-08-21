import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { durableWriteFile } from '../durable-file.js';
import { safePath } from './path.js';
const objectSchema = (properties, required) => ({
    properties,
    required,
});
const stringProperty = { type: 'string' };
const pathInput = z.object({ path: z.string().min(1) }).strict();
export const readFileTool = {
    definition: {
        name: 'read_file',
        description: 'Read a UTF-8 file within the project.',
        inputSchema: objectSchema({ path: stringProperty }, ['path']),
    },
    schema: pathInput,
    async execute({ path: file }, { root }) {
        return readFile(safePath(root, file), 'utf8');
    },
};
const writeInput = z.object({ path: z.string().min(1), content: z.string() }).strict();
export const writeFileTool = {
    definition: {
        name: 'write_file',
        description: 'Create or replace a UTF-8 file within the project.',
        inputSchema: objectSchema({ path: stringProperty, content: stringProperty }, [
            'path',
            'content',
        ]),
    },
    schema: writeInput,
    async execute({ path: file, content }, { root }) {
        const target = safePath(root, file);
        await durableWriteFile(target, content);
        return `Wrote ${Buffer.byteLength(content)} bytes to ${file}.`;
    },
};
const editInput = z
    .object({ path: z.string().min(1), oldText: z.string().min(1), newText: z.string() })
    .strict();
export const editFileTool = {
    definition: {
        name: 'edit_file',
        description: 'Replace one exact occurrence in an existing file. Read it first.',
        inputSchema: objectSchema({ path: stringProperty, oldText: stringProperty, newText: stringProperty }, ['path', 'oldText', 'newText']),
    },
    schema: editInput,
    async execute({ path: file, oldText, newText }, { root }) {
        const target = safePath(root, file);
        const current = await readFile(target, 'utf8');
        const first = current.indexOf(oldText);
        if (first < 0)
            throw new Error('oldText was not found.');
        if (current.indexOf(oldText, first + oldText.length) >= 0)
            throw new Error('oldText is not unique.');
        await durableWriteFile(target, current.replace(oldText, newText));
        return `Edited ${file}.`;
    },
};
export const deleteFileTool = {
    definition: {
        name: 'delete_file',
        description: 'Delete a file or empty directory within the project.',
        inputSchema: objectSchema({ path: stringProperty }, ['path']),
    },
    schema: pathInput,
    async execute({ path: file }, context) {
        if (!(await context.approve(`delete ${file}`)))
            throw new Error('Operation was not approved.');
        await rm(safePath(context.root, file), { recursive: false });
        return `Deleted ${file}.`;
    },
};
const listInput = z
    .object({ path: z.string().default('.'), depth: z.number().int().min(1).max(8).default(4) })
    .strict();
export const listFilesTool = {
    definition: {
        name: 'list_files',
        description: 'List project files recursively.',
        inputSchema: objectSchema({ path: stringProperty, depth: { type: 'number' } }, []),
    },
    schema: listInput,
    async execute({ path: requested, depth }, { root }) {
        const start = safePath(root, requested);
        const output = [];
        async function walk(directory, level) {
            if (level > depth)
                return;
            for (const entry of await readdir(directory, { withFileTypes: true })) {
                if (['node_modules', '.git', 'dist', 'coverage'].includes(entry.name))
                    continue;
                const absolute = path.join(directory, entry.name);
                output.push(path.relative(root, absolute).split(path.sep).join('/'));
                if (entry.isDirectory())
                    await walk(absolute, level + 1);
            }
        }
        await walk(start, 1);
        return output.slice(0, 1000).join('\n');
    },
};
const searchInput = z.object({ query: z.string().min(1), path: z.string().default('.') }).strict();
export const searchFilesTool = {
    definition: {
        name: 'search_files',
        description: 'Search text in project files.',
        inputSchema: objectSchema({ query: stringProperty, path: stringProperty }, ['query']),
    },
    schema: searchInput,
    async execute({ query, path: requested }, context) {
        const listing = await listFilesTool.execute({ path: requested, depth: 8 }, context);
        const matches = [];
        for (const file of listing.split('\n')) {
            if (!file || /\.(png|jpg|jpeg|gif|zip|lock)$/i.test(file))
                continue;
            try {
                const lines = (await readFile(safePath(context.root, file), 'utf8')).split('\n');
                lines.forEach((line, index) => {
                    if (line.includes(query))
                        matches.push(`${file}:${index + 1}:${line}`);
                });
            }
            catch {
                /* Ignore non-files and non-text files. */
            }
            if (matches.length >= 200)
                break;
        }
        return matches.join('\n') || 'No matches.';
    },
};
export const createDirectoryTool = {
    definition: {
        name: 'create_directory',
        description: 'Create a directory within the project.',
        inputSchema: objectSchema({ path: stringProperty }, ['path']),
    },
    schema: pathInput,
    async execute({ path: directory }, { root }) {
        await mkdir(safePath(root, directory), { recursive: true });
        return `Created ${directory}.`;
    },
};
