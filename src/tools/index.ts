import type { Tool } from './tool.js';
import {
  createDirectoryTool,
  deleteFileTool,
  editFileTool,
  listFilesTool,
  readFileTool,
  searchFilesTool,
  writeFileTool,
} from './files.js';
import { runCommandTool } from './command.js';

export const allTools: Tool<unknown>[] = [
  readFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  listFilesTool,
  searchFilesTool,
  runCommandTool,
  createDirectoryTool,
] as Tool<unknown>[];
export { executeTool } from './tool.js';
export type { Tool, ToolContext } from './tool.js';
