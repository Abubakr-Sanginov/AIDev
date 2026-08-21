import { z } from 'zod';
import type { Tool } from './tool.js';
declare const input: any;
export declare const runCommandTool: Tool<z.infer<typeof input>>;
export {};
