import { randomUUID } from 'node:crypto';
import type {
  AgentRequest,
  AuthResult,
  CodingRuntime,
  InstallInstructions,
  InstallResult,
  LaunchOptions,
  RuntimeDetection,
  RuntimeResult,
  RuntimeSession,
  RuntimeState,
} from '../runtime.js';

export type MockBehavior = 'success' | 'failure' | 'timeout' | 'crash';
export interface MockResponse {
  behavior: MockBehavior;
  output?: string;
}
export class MockRuntime implements CodingRuntime {
  readonly id = 'mock';
  readonly name = 'Mock Runtime';
  readonly #responses: MockResponse[];
  readonly sessions = new Map<string, RuntimeSession>();
  constructor(responses: MockResponse[] = []) {
    this.#responses = responses;
  }
  async detect(): Promise<RuntimeDetection> {
    return { installed: true, ready: true, authenticated: 'yes', version: '1.0.0' };
  }
  getInstallInstructions(): InstallInstructions {
    return { command: '', description: 'Built in for tests.', officialUrl: '' };
  }
  async install(): Promise<InstallResult> {
    return { success: true, message: 'Mock runtime is built in.' };
  }
  async authenticate(): Promise<AuthResult> {
    return { success: true, message: 'Mock runtime is ready.' };
  }
  async discoverModels(): Promise<{ models: string[] }> {
    return { models: [] };
  }
  async launch(options: LaunchOptions): Promise<RuntimeSession> {
    const session: RuntimeSession = {
      id: randomUUID(),
      runtimeId: this.id,
      roleId: options.roleId,
      workingDirectory: options.workingDirectory,
      status: 'running',
      createdAt: new Date().toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }
  async execute(session: RuntimeSession, _request: AgentRequest): Promise<RuntimeResult> {
    const response = this.#responses.shift() ?? { behavior: 'success', output: 'VERDICT: PASS' };
    if (response.behavior === 'timeout') throw new Error('Mock runtime timed out.');
    if (response.behavior === 'crash') {
      session.status = 'failed';
      throw new Error('Mock runtime crashed.');
    }
    session.status = response.behavior === 'success' ? 'completed' : 'failed';
    return {
      success: response.behavior === 'success',
      output: response.output ?? '',
      sessionId: session.id,
      exitCode: response.behavior === 'success' ? 0 : 1,
    };
  }
  async pause(session: RuntimeSession): Promise<void> {
    session.status = 'paused';
  }
  async resume(session: RuntimeSession): Promise<void> {
    session.status = 'running';
  }
  async stop(session: RuntimeSession): Promise<void> {
    session.status = 'stopped';
  }
  async getStatus(session: RuntimeSession): Promise<RuntimeState> {
    return session.status;
  }
}
