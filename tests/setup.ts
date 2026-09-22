import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach } from 'vitest';

let home: string | undefined;

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'ai-dev-team-home-'));
  process.env.AI_DEV_TEAM_HOME = home;
});

afterEach(() => {
  if (home !== undefined) rmSync(home, { recursive: true, force: true });
  home = undefined;
  delete process.env.AI_DEV_TEAM_HOME;
});
