import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
export function historyPath(root) {
    return path.join(root, '.ai-dev-team', 'history.jsonl');
}
export async function appendRunRecord(root, record) {
    await mkdir(path.dirname(historyPath(root)), { recursive: true });
    await appendFile(historyPath(root), JSON.stringify(record) + '\n', 'utf8');
}
export async function listRunRecords(root, limit = 20) {
    let source;
    try {
        source = await readFile(historyPath(root), 'utf8');
    }
    catch {
        return [];
    }
    const records = [];
    for (const line of source.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed.goal === 'string' && typeof parsed.status === 'string')
                records.push(parsed);
        }
        catch {
            // Skip corrupted history lines instead of failing the command.
        }
    }
    return records.slice(-Math.max(1, limit)).reverse();
}
