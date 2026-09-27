import { describe, expect, it } from 'vitest';
import {
  ChatRenderer,
  formatTokens,
  parseChatKeys,
  renderChatHeader,
  renderEventLine,
  renderRoleBlock,
  renderRunSummary,
  renderStatusLine,
  wordWrap,
  type RoleBlockInfo,
} from '../src/ui/chat.js';
import { resolveTheme } from '../src/ui/ascii.js';
import { PauseCancelledError, PauseGate } from '../src/pause.js';
import type {
  RuntimeWorkflowEvent,
  RuntimeWorkflowState,
} from '../src/runtimes/runtime-orchestrator.js';

const theme = resolveTheme('mono');

function event(partial: Partial<RuntimeWorkflowEvent>): RuntimeWorkflowEvent {
  return {
    roleId: 'manager',
    status: 'ACTIVE',
    message: 'working',
    timestamp: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function state(partial: Partial<RuntimeWorkflowState> = {}): RuntimeWorkflowState {
  return {
    goal: 'build a snake game',
    runtimeId: 'claude',
    status: 'RUNNING',
    attempts: 0,
    sessions: [],
    events: [],
    startedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:02:00.000Z',
    ...partial,
  };
}

describe('wordWrap', () => {
  it('wraps text to the given width without breaking words', () => {
    const lines = wordWrap('the quick brown fox jumps over the lazy dog', 16);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(16);
    expect(lines.join(' ')).toBe('the quick brown fox jumps over the lazy dog');
  });

  it('hard-breaks words longer than the width', () => {
    const lines = wordWrap('x'.repeat(50), 20);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toHaveLength(20);
  });

  it('keeps empty lines as paragraph separators', () => {
    expect(wordWrap('one\n\ntwo', 20)).toEqual(['one', '', 'two']);
  });
});

describe('formatTokens', () => {
  it('formats token counts like Claude Code', () => {
    expect(formatTokens(850)).toBe('850');
    expect(formatTokens(54_800)).toBe('54.8k');
    expect(formatTokens(1_250_000)).toBe('1.25M');
  });
});

describe('renderRoleBlock', () => {
  const base: RoleBlockInfo = {
    roleId: 'manager',
    text: 'Plan: build the game in three steps.',
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:30.000Z',
    toolCalls: 2,
  };

  it('prints the role name at the top of the block', () => {
    const block = renderRoleBlock(theme, base, 80);
    expect(block.split('\n')[0]).toBe('● Manager');
  });

  it('indents the artifact text and adds a meta line', () => {
    const lines = renderRoleBlock(theme, base, 80).split('\n');
    expect(lines[1]).toBe('  Plan: build the game in three steps.');
    expect(lines.at(-1)).toContain('✓');
    expect(lines.at(-1)).toContain('30s');
    expect(lines.at(-1)).toContain('2 tool calls');
  });

  it('truncates very long artifacts with a pointer to the logs', () => {
    const lines = renderRoleBlock(theme, { ...base, text: 'line\n'.repeat(150) }, 80).split('\n');
    // Header + 100 kept text lines + the truncation note + the meta line.
    expect(lines).toHaveLength(103);
    expect(lines.at(-2)).toContain('full artifact');
  });
});

describe('renderEventLine', () => {
  it('filters the not-scheduled noise from terminalize()', () => {
    expect(
      renderEventLine(
        theme,
        event({ status: 'SKIPPED', message: 'Agent was not scheduled for this workflow.' }),
        80,
      ),
    ).toBeUndefined();
  });

  it('renders failures and cancellations', () => {
    expect(renderEventLine(theme, event({ status: 'FAILED', message: 'boom' }), 80)).toContain(
      'boom',
    );
    expect(
      renderEventLine(theme, event({ status: 'CANCELLED', message: 'Interrupted by user.' }), 80),
    ).toContain('cancelled');
  });
});

describe('renderRunSummary', () => {
  it('celebrates a completed run with duration and tokens', () => {
    const summary = renderRunSummary(
      theme,
      state({ status: 'DONE', tokensUsed: 54_800, updatedAt: '2026-01-01T00:14:25.000Z' }),
      Date.parse('2026-01-01T00:14:25.000Z'),
    );
    expect(summary).toContain('✔ Task complete');
    expect(summary).toContain('14m 25s');
    expect(summary).toContain('54.8k tokens');
  });

  it('reports an interrupted run calmly and failures with the reason', () => {
    const interrupted = renderRunSummary(
      theme,
      state({ status: 'FAILED', failureReason: 'Interrupted by user.' }),
      Date.parse('2026-01-01T00:01:00.000Z'),
    );
    expect(interrupted).toContain('Interrupted');
    const failed = renderRunSummary(
      theme,
      state({
        status: 'FAILED',
        failureReason: 'Tester reported defects; the quality gate did not pass.',
      }),
      Date.parse('2026-01-01T00:01:00.000Z'),
    );
    expect(failed).toContain('✖ Task failed');
    expect(failed).toContain('Tester reported defects');
  });
});

describe('renderStatusLine', () => {
  it('shows the working role and latest activity', () => {
    const line = renderStatusLine(theme, {
      state: state({ currentRoleId: 'backend' }),
      frame: '⠋',
      now: Date.parse('2026-01-01T00:00:34.000Z'),
      activity: 'Tool call: run_command',
    });
    expect(line).toContain('⠋');
    expect(line).toContain('Backend Developer');
    expect(line).toContain('34s');
  });

  it('marks the paused phase', () => {
    const line = renderStatusLine(theme, {
      state: state({ pause: 'paused' }),
      now: Date.parse('2026-01-01T00:00:10.000Z'),
    });
    expect(line).toContain('paused');
  });
});

describe('parseChatKeys', () => {
  it('splits printable runs, including Cyrillic', () => {
    expect(parseChatKeys('абв')).toEqual([{ type: 'char', text: 'абв' }]);
  });

  it('recognizes enter, backspace and control keys', () => {
    expect(parseChatKeys('\r')).toEqual([{ type: 'enter' }]);
    expect(parseChatKeys('\x7f')).toEqual([{ type: 'backspace' }]);
    expect(parseChatKeys('\x03')).toEqual([{ type: 'ctrl-c' }]);
    expect(parseChatKeys('\x10')).toEqual([{ type: 'ctrl-p' }]);
    expect(parseChatKeys('\x15')).toEqual([{ type: 'ctrl-u' }]);
  });

  it('recognizes escape and arrow keys', () => {
    expect(parseChatKeys('\x1b')).toEqual([{ type: 'escape' }]);
    expect(parseChatKeys('\x1b[A')).toEqual([{ type: 'up' }]);
    expect(parseChatKeys('\x1b[B')).toEqual([{ type: 'down' }]);
    expect(parseChatKeys('\x1bOH')).toEqual([]);
  });

  it('parses a mixed chunk in order', () => {
    expect(parseChatKeys('ab\r')).toEqual([{ type: 'char', text: 'ab' }, { type: 'enter' }]);
  });
});

describe('ChatRenderer', () => {
  it('emits a role header on RUNNING and a block with tool-call count on DONE', () => {
    const renderer = new ChatRenderer(theme);
    const first = renderer.consume(
      state({
        events: [
          event({ roleId: 'backend', status: 'RUNNING', timestamp: '2026-01-01T00:00:00.000Z' }),
        ],
      }),
      80,
    );
    expect(first.lines).toEqual(['● Backend Developer']);

    const second = renderer.consume(
      state({
        events: [
          event({ roleId: 'backend', status: 'RUNNING', timestamp: '2026-01-01T00:00:00.000Z' }),
          event({ roleId: 'backend', status: 'ACTIVE', message: 'Tool call: write_file' }),
          event({ roleId: 'backend', status: 'ACTIVE', message: 'Tool call: write_file' }),
          event({
            roleId: 'backend',
            status: 'DONE',
            message: 'Implemented the endpoint.',
            timestamp: '2026-01-01T00:01:00.000Z',
          }),
        ],
      }),
      80,
    );
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0]).toContain('Implemented the endpoint.');
    expect(second.lines[0]).toContain('2 tool calls');
    expect(second.activity).toBe('Running write_file…');
  });

  it('never renders the same event twice', () => {
    const renderer = new ChatRenderer(theme);
    const workflowState = state({
      events: [event({ status: 'DONE', message: 'Plan ready.' })],
    });
    expect(renderer.consume(workflowState, 80).lines).toHaveLength(1);
    expect(renderer.consume(workflowState, 80).lines).toHaveLength(0);
  });

  it('passes browser progress through as event lines, not role blocks', () => {
    const renderer = new ChatRenderer(theme);
    const { lines } = renderer.consume(
      state({
        events: [
          event({ roleId: 'browser', status: 'ACTIVE', message: 'Opening http://localhost:3000' }),
          event({ roleId: 'browser', status: 'DONE', message: 'Browser check passed.' }),
        ],
      }),
      80,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Opening http://localhost:3000');
    expect(lines[1]).toContain('Browser check passed.');
  });
});

describe('renderChatHeader', () => {
  it('includes the runtime, model label and project path', () => {
    const header = renderChatHeader(theme, {
      version: '1.2.3',
      runtimeName: 'Claude Code',
      modelLabel: 'Auto (2 models, free first)',
      root: '/tmp/project',
    });
    expect(header).toContain('AI Dev Team');
    expect(header).toContain('v1.2.3');
    expect(header).toContain('Claude Code');
    expect(header).toContain('Auto (2 models, free first)');
    expect(header).toContain('/tmp/project');
  });
});

describe('PauseGate cancellation', () => {
  it('rejects waiters and aborts the signal', async () => {
    const gate = new PauseGate();
    gate.pause();
    const waiting = gate.wait();
    gate.cancel();
    await expect(waiting).rejects.toBeInstanceOf(PauseCancelledError);
    expect(gate.cancelled).toBe(true);
    expect(gate.signal.aborted).toBe(true);
    await expect(gate.wait()).rejects.toBeInstanceOf(PauseCancelledError);
  });

  it('rejects immediately when already cancelled', async () => {
    const gate = new PauseGate();
    gate.cancel();
    await expect(gate.wait()).rejects.toBeInstanceOf(PauseCancelledError);
  });

  it('still resolves normally while running', async () => {
    const gate = new PauseGate();
    await expect(gate.wait()).resolves.toBeUndefined();
  });
});
