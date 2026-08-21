import path from 'node:path';
import { durableWriteFile } from './durable-file.js';
import { roles } from './roles.js';
import { formatDuration } from './ui/ascii.js';
import type {
  RuntimeWorkflowEvent,
  RuntimeWorkflowState,
} from './runtimes/runtime-orchestrator.js';

function cell(text: string): string {
  return text.replaceAll('|', '\\|').slice(0, 120);
}

export function buildReport(state: RuntimeWorkflowState): string {
  const lines: string[] = [
    '# AI Dev Team — Run Report',
    '',
    `- Goal: ${state.goal}`,
    `- Status: ${state.status}`,
    `- Runtime: ${state.runtimeId}`,
    `- Fix cycles: ${state.attempts}`,
  ];
  if (state.startedAt) lines.push(`- Started: ${state.startedAt}`);
  if (state.updatedAt) lines.push(`- Finished: ${state.updatedAt}`);
  if (state.startedAt && state.updatedAt)
    lines.push(
      `- Duration: ${formatDuration(Date.parse(state.updatedAt) - Date.parse(state.startedAt))}`,
    );
  lines.push('', '## Phases', '', '| Role | Status | Last message |', '| --- | --- | --- |');
  const latest = new Map<string, RuntimeWorkflowEvent>();
  for (const event of state.events) latest.set(event.roleId, event);
  for (const role of roles) {
    const event = latest.get(role.id);
    const status = event?.status ?? 'NOT SCHEDULED';
    const lastMessage = event ? cell(event.message.split('\n')[0] ?? '') : '';
    lines.push(`| ${role.name} | ${status} | ${lastMessage} |`);
  }
  const failures = state.events.filter((event) => event.status === 'FAILED');
  if (failures.length > 0) {
    lines.push('', '## Failures', '');
    for (const failure of failures.slice(-10))
      lines.push(`- **${failure.roleId}**: ${(failure.message.split('\n')[0] ?? '').slice(0, 200)}`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function writeReport(root: string, state: RuntimeWorkflowState): Promise<string> {
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const file = path.join(root, '.ai-dev-team', `report-${stamp}.md`);
  await durableWriteFile(file, buildReport(state));
  return file;
}
