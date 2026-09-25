import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Resolves an object key to a real filesystem path beneath `root`, throwing
 * if the key would escape it. Mirrors marketplace-service's
 * images/safe-local-path.ts exactly — same risk (a key taken from a URL
 * path segment or a server-generated value must never escape the storage
 * root), same guard.
 */
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
