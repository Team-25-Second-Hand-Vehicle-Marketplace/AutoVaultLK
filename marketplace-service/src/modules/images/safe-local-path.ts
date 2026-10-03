import { isAbsolute, relative, resolve } from 'node:path';

export function safeLocalPath(root: string, key: string): string {
  if (!key || isAbsolute(key) || key.includes('\0')) {
    throw new Error(`Invalid object key: ${JSON.stringify(key)}`);
  }

  const resolvedRoot = resolve(root);
  const path = resolve(resolvedRoot, key);
  const rel = relative(resolvedRoot, path);

  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Object key escapes the storage root: ${key}`);
  }

  return path;
}
