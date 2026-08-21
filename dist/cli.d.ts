#!/usr/bin/env node
import { type RuntimeWorkflowState } from './runtimes/runtime-orchestrator.js';
export declare function renderRuntimeState(state: RuntimeWorkflowState, root: string, verbose?: boolean): string;
