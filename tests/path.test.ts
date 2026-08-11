import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { safePath } from '../src/tools/path.js';

describe('safePath', () => {
  const root = path.resolve('sandbox');
  it('allows paths inside root', () =>
    expect(safePath(root, 'src/index.ts')).toBe(path.join(root, 'src/index.ts')));
  it('rejects traversal', () => expect(() => safePath(root, '../secret')).toThrow(/escapes/));
  it('rejects absolute paths', () =>
    expect(() => safePath(root, path.resolve('outside'))).toThrow(/Absolute/));
});
