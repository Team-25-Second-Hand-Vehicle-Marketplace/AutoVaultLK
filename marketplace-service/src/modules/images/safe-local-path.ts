import { isAbsolute, relative, resolve } from 'node:path';

/**
 * Resolves an object key to a real filesystem path beneath `root`, throwing
 * if the key would escape it.
 *
 * Mirrors ingestion-service's LocalObjectStore.pathFor exactly — that guard
 * cannot be imported here (separate npm package, separate deployable), but
 * the risk is identical: `local` mode's images route takes a key straight
 * from a URL path segment, so a request for
 * `/images/local/../../.env` is not a hypothetical, it is the first thing
 * anyone will try. Keeping the same key convention (`raw/`, `images/`,
 * `staging/` — see s3-images/main.tf's lifecycle comment) as the write side
 * is also why the resolver builds `/images/local/{key}` unmodified rather
 * than re-deriving it: one escaping key found here is one that would have
 * escaped on write too, so this is a second gate on a value that already
 * passed the first.
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
