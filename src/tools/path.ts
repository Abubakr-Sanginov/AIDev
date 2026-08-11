import path from 'node:path';

export function safePath(root: string, requested: string): string {
  if (path.isAbsolute(requested)) throw new Error('Absolute paths are not allowed.');
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, requested);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes the project directory.');
  }
  return resolved;
}
