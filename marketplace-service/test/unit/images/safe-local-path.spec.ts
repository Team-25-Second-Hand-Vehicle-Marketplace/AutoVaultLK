import { resolve } from 'node:path';
import { safeLocalPath } from '../../../src/modules/images/safe-local-path';

/**
 * Mirrors ingestion-service's LocalObjectStore.pathFor test coverage
 * exactly (test/unit/infrastructure/storage/local-object-store.spec.ts) —
 * this function is a deliberate copy of that guard, kept because
 * LocalImagesController takes an object key straight from a URL path
 * segment, and a traversal attempt here is not hypothetical: it is the
 * first thing anyone will try against `/images/local/*`.
 */
describe('safeLocalPath', () => {
  const root = resolve('/tmp/marketplace-images-root');

  it('resolves a normal key beneath the root', () => {
    expect(safeLocalPath(root, 'images/job-1/veh-1/0-x.jpg')).toBe(
      resolve(root, 'images/job-1/veh-1/0-x.jpg'),
    );
  });

  it('resolves a deeply nested key', () => {
    expect(safeLocalPath(root, 'a/b/c/d/e.jpg')).toBe(
      resolve(root, 'a/b/c/d/e.jpg'),
    );
  });

  it.each([
    ['../escape.jpg'],
    ['images/../../escape.jpg'],
    ['../../etc/passwd'],
    ['a/../../b.jpg'],
  ])('refuses key %s that escapes the storage root', (key) => {
    expect(() => safeLocalPath(root, key)).toThrow(/escapes the storage root/);
  });

  it.each([[''], ['/absolute/path.jpg'], ['bad\0key.jpg']])(
    'refuses invalid key %s',
    (key) => {
      expect(() => safeLocalPath(root, key)).toThrow(/Invalid object key/);
    },
  );

  // A key that merely contains ".." as a substring of a legitimate segment
  // name (not a path component) must not be rejected — only ".." as its own
  // path segment is a traversal attempt.
  it('accepts a key containing ".." as part of a filename, not a path segment', () => {
    expect(() => safeLocalPath(root, 'images/job-1/a..b.jpg')).not.toThrow();
  });
});
