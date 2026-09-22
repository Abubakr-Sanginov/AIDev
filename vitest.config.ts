import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Isolates the per-user store (~/.ai-dev-team) so tests never touch the real one.
    setupFiles: ['tests/setup.ts'],
  },
});
