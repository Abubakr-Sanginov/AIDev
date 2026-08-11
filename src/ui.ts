import chalk from 'chalk';
import type { AgentStatus, ProjectState, Role } from './types.js';

const roles: Role[] = ['Manager', 'Architect', 'Coder', 'Tester', 'Fixer', 'Reviewer'];

export interface UI {
  render(state: ProjectState, activity: string[]): void;
  log(line: string): void;
}

export class LiveUI implements UI {
  readonly #color: boolean;
  readonly #interactive: boolean;
  #renderedLines = 0;

  constructor(options: { color?: boolean; interactive?: boolean } = {}) {
    this.#color = options.color ?? (process.stdout.isTTY && !process.env.NO_COLOR);
    this.#interactive = options.interactive ?? process.stdout.isTTY;
  }

  render(state: ProjectState, activity: string[]): void {
    const lines = [
      'AI DEVELOPMENT TEAM',
      '===================',
      '',
      'AGENTS',
      '------',
      ...roles.map(
        (role) =>
          `${role.padEnd(12)} ${this.#status(state.tasks.find((t) => t.role === role)?.status ?? 'WAITING')}`,
      ),
      '',
      'CURRENT TASK',
      '------------',
      state.currentTask,
      '',
      'ACTIVITY',
      '--------',
      ...activity.slice(-6),
      '',
    ];
    if (this.#interactive && this.#renderedLines > 0)
      process.stdout.write(`\x1B[${this.#renderedLines}A\x1B[0J`);
    process.stdout.write(lines.join('\n') + '\n');
    this.#renderedLines = lines.length;
  }

  log(line: string): void {
    process.stdout.write(`${line}\n`);
  }

  #status(status: AgentStatus): string {
    const text = `[ ${status} ]`;
    if (!this.#color) return text;
    if (status === 'DONE') return chalk.green(text);
    if (status === 'FAILED' || status === 'BLOCKED') return chalk.red(text);
    if (status === 'RUNNING') return chalk.cyan(text);
    return chalk.gray(text);
  }
}
