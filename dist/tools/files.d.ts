import { z } from 'zod';
import type { Tool } from './tool.js';
declare const pathInput: z.ZodObject<{
    path: z.ZodString;
}, "strict", z.ZodTypeAny, {
    path: string;
}, {
    path: string;
}>;
export declare const readFileTool: Tool<z.infer<typeof pathInput>>;
declare const writeInput: z.ZodObject<{
    path: z.ZodString;
    content: z.ZodString;
}, "strict", z.ZodTypeAny, {
    path: string;
    content: string;
}, {
    path: string;
    content: string;
}>;
export declare const writeFileTool: Tool<z.infer<typeof writeInput>>;
declare const editInput: z.ZodObject<{
    path: z.ZodString;
    oldText: z.ZodString;
    newText: z.ZodString;
}, "strict", z.ZodTypeAny, {
    path: string;
    oldText: string;
    newText: string;
}, {
    path: string;
    oldText: string;
    newText: string;
}>;
export declare const editFileTool: Tool<z.infer<typeof editInput>>;
export declare const deleteFileTool: Tool<z.infer<typeof pathInput>>;
declare const listInput: z.ZodObject<{
    path: z.ZodDefault<z.ZodString>;
    depth: z.ZodDefault<z.ZodNumber>;
}, "strict", z.ZodTypeAny, {
    path: string;
    depth: number;
}, {
    path?: string | undefined;
    depth?: number | undefined;
}>;
export declare const listFilesTool: Tool<z.infer<typeof listInput>>;
declare const searchInput: z.ZodObject<{
    query: z.ZodString;
    path: z.ZodDefault<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    path: string;
    query: string;
}, {
    query: string;
    path?: string | undefined;
}>;
export declare const searchFilesTool: Tool<z.infer<typeof searchInput>>;
export declare const createDirectoryTool: Tool<z.infer<typeof pathInput>>;
export {};
