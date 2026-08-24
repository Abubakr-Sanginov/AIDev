import { z } from 'zod';
import type { Tool } from './tool.js';
declare const input: z.ZodObject<{
    command: z.ZodString;
    cwd: z.ZodDefault<z.ZodString>;
    timeoutMs: z.ZodDefault<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    cwd: string;
    command: string;
    timeoutMs: number;
}, {
    command: string;
    cwd?: string | undefined;
    timeoutMs?: number | undefined;
}>;
export declare const runCommandTool: Tool<z.infer<typeof input>>;
export {};
