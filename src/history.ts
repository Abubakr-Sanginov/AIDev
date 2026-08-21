import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export interface RunRecord {
  goal: string;
  runtimeId: string;
  model?: string;
  status: string;
  attempts: number;
  startedAt?: string;
  finishedAt: string;
  durationMs?: number;
}

export function historyPath(root: string): string {
  return path.join(root, '.ai-dev-team', 'history.jsonl');
}

export async function appendRunRecord(root: string, record: RunRecord): Promise<void> {
  await mkdir(path.dirname(historyPath(root)), { recursive: true });
  await appendFile(historyPath(root), JSON.stringify(record) + '\n', 'utf8');
}

export async function listRunRecords(root: string, limit = 20): Promise<RunRecord[]> {
  let source: string;
  try {
    source = await readFile(historyPath(root), 'utf8');
  } catch {
    return [];
  }
  const records: RunRecord[] = [];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as RunRecord;
      if (typeof parsed.goal === 'string' && typeof parsed.status === 'string')
        records.push(parsed);
    } catch {
      // Skip corrupted history lines instead of failing the command.
    }
  }
  return records.slice(-Math.max(1, limit)).reverse();
}
