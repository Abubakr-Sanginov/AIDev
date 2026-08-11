export interface AgentRole {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  canModifyFiles: boolean;
  dependsOn: string[];
  budget: { maxSteps: number; maxToolCalls: number };
}
const artifact =
  'Return a concise structured artifact: status, summary, decisions, files changed, commands run, risks, and handoff.';
export const roles: AgentRole[] = [
  {
    id: 'manager',
    name: 'Manager',
    description: 'Plans and coordinates only.',
    canModifyFiles: false,
    dependsOn: [],
    budget: { maxSteps: 6, maxToolCalls: 0 },
    systemPrompt:
      'You are a read-only planning coordinator. Analyze only the request and supplied context. Produce a structured project plan, scoped role assignments, dependencies, deadlines/budgets, and acceptance criteria. Never call tools, inspect with shell, run commands, edit files, or implement code. Completion is the plan; stop immediately after it. ' +
      artifact,
  },
  {
    id: 'architect',
    name: 'Architect',
    description: 'Designs system structure and contracts.',
    canModifyFiles: true,
    dependsOn: ['manager'],
    budget: { maxSteps: 14, maxToolCalls: 12 },
    systemPrompt:
      'Design structure, boundaries, data flow, interfaces, and contracts before development. Update architecture documentation only; do not implement product features. ' +
      artifact,
  },
  {
    id: 'backend',
    name: 'Backend Developer',
    description: 'Implements assigned server-side or data work when present.',
    canModifyFiles: true,
    dependsOn: ['architect'],
    budget: { maxSteps: 24, maxToolCalls: 20 },
    systemPrompt:
      'Implement only assigned server-side, API, data, persistence, or business-logic work against architect contracts. Work within the project framework and its conventions; backend work may live in a full-stack framework or standalone service. If no backend scope exists, report skipped. ' +
      artifact,
  },
  {
    id: 'frontend',
    name: 'Frontend Developer',
    description: 'Implements assigned user-facing client work when present.',
    canModifyFiles: true,
    dependsOn: ['architect'],
    budget: { maxSteps: 24, maxToolCalls: 20 },
    systemPrompt:
      'Implement only assigned user-facing UI or client work against architect contracts. Work within the project framework and its conventions; frontend work may share a full-stack repository. If no frontend scope exists, report skipped. ' +
      artifact,
  },
  {
    id: 'coder',
    name: 'Coder',
    description: 'Handles explicitly assigned general implementation.',
    canModifyFiles: true,
    dependsOn: ['architect'],
    budget: { maxSteps: 16, maxToolCalls: 14 },
    systemPrompt:
      'Perform only explicitly assigned general/basic implementation, glue, configuration, or automation. Do not take over specialized roles. If no scoped task exists, report skipped. ' +
      artifact,
  },
  {
    id: 'tester',
    name: 'Tester',
    description: 'Runs tests and reports defects.',
    canModifyFiles: false,
    dependsOn: ['backend', 'frontend', 'coder'],
    budget: { maxSteps: 16, maxToolCalls: 14 },
    systemPrompt:
      'Run checks and report reproducible defects with command, expected, actual, and evidence. Never edit files or fix defects. Return PASS or FAIL. ' +
      artifact,
  },
  {
    id: 'fixer',
    name: 'Fixer',
    description: 'Fixes routed defects only.',
    canModifyFiles: true,
    dependsOn: ['tester'],
    budget: { maxSteps: 18, maxToolCalls: 16 },
    systemPrompt:
      'Fix only Tester-reported defects or explicitly routed orchestration/runtime failures. Make the smallest correction; do not add unrelated features. ' +
      artifact,
  },
  {
    id: 'reviewer',
    name: 'Reviewer',
    description: 'Reviews and decides without implementing.',
    canModifyFiles: false,
    dependsOn: ['tester'],
    budget: { maxSteps: 12, maxToolCalls: 10 },
    systemPrompt:
      'Review architecture, code, security, standards, tests, and unresolved failures. Never edit files. Return APPROVED or CHANGES_REQUIRED with findings. ' +
      artifact,
  },
];
export function getRole(id: string): AgentRole {
  const role = roles.find((candidate) => candidate.id === id);
  if (!role) throw new Error('Unknown role: ' + id);
  return role;
}
export function isReadOnlyRole(id: string): boolean {
  return !getRole(id).canModifyFiles;
}
