export type Role = 'Manager' | 'Architect' | 'Coder' | 'Tester' | 'Fixer' | 'Reviewer';
export type AgentStatus = 'WAITING' | 'RUNNING' | 'DONE' | 'FAILED' | 'BLOCKED';

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface LLMResponse {
  content: string;
  toolCalls: ToolCall[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface LLMProvider {
  generate(messages: Message[], tools: ToolDefinition[]): Promise<LLMResponse>;
}

export interface AgentResult {
  role: Role;
  output: string;
  toolResults: ToolExecutionResult[];
  iterations: number;
}

export interface ToolExecutionResult {
  ok: boolean;
  tool: string;
  output: string;
  error?: string;
}

export interface ProjectTask {
  id: string;
  role: Role;
  description: string;
  status: AgentStatus;
  result?: string;
}

export interface ProjectState {
  version: 1;
  goal: string;
  status: AgentStatus;
  currentTask: string;
  updatedAt: string;
  tasks: ProjectTask[];
  verificationAttempts: number;
}
