import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Isolates the per-user store (~/.ai-dev-team) so tests never touch the real one.
    setupFiles: ['tests/setup.ts'],
    // Default excludes plus stray tool worktrees (e.g. .kilo) that otherwise
    // get swept up and double-count the suite.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.{git,cache,output,temp}/**', '**/.kilo/**'],
  },
});
