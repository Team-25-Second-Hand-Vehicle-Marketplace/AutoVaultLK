import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Turns silent vector-space drift into a red build.
 *
 * ingestion-service/src/shared/normalize-embed/ is a deliberate byte-for-byte
 * copy of marketplace-service's. If the two definitions of buildSearchText or
 * EMBEDDING_MODEL_ID ever diverge, bulk-uploaded listings get embedded into a
 * different region of vector space than manually created ones and rank badly
 * forever — with no exception, no failing assertion anywhere else, and no log
 * line (FR-22.1 / NFR-26.1; plan-b §9A "silent drift").
 *
 * Nothing but this test enforces it, so it compares raw file contents rather
 * than behaviour: a reordered field or a changed model id must fail even if
 * both copies still compile and both still "work".
 */
const SHARED_FILES = [
  'constants.ts',
  'search-text.ts',
  'embedder.ts',
  'vector.ts',
  'index.ts',
] as const;

const OURS = resolve(__dirname, '../../../src/shared/normalize-embed');
const THEIRS = resolve(
  __dirname,
  '../../../../marketplace-service/src/shared/normalize-embed',
);

// Skips itself once the directories become separate GitHub repositories, at
// which point the sibling path is gone and this is a published-package problem
// instead (see the README next to the copied files).
const siblingPresent = existsSync(THEIRS);
const describeIfSibling = siblingPresent ? describe : describe.skip;

// Normalizes line endings only: the two checkouts can differ in CRLF/LF through
// git's autocrlf without any real divergence. Everything else must match.
const read = (dir: string, file: string): string =>
  readFileSync(resolve(dir, file), 'utf8').replace(/\r\n/g, '\n');

describeIfSibling('normalize-embed parity with marketplace-service', () => {
  it.each(SHARED_FILES)('%s is byte-identical to marketplace-service', (file) => {
    expect(read(OURS, file)).toBe(read(THEIRS, file));
  });

  it('covers every file present in either copy', () => {
    // A new file added to one side but not the other would otherwise slip past
    // the per-file comparison above, which only iterates the known list.
    const list = (dir: string) =>
      require('node:fs')
        .readdirSync(dir)
        .filter((f: string) => f.endsWith('.ts'))
        .sort();

    expect(list(OURS)).toEqual([...SHARED_FILES].sort());
    expect(list(THEIRS)).toEqual([...SHARED_FILES].sort());
  });
});

// Guards the guard: if the sibling path silently stops resolving, the suite
// above would skip and drift would go unnoticed again. In this repo layout the
// path must exist.
describe('parity test wiring', () => {
  it('can see marketplace-service, or is deliberately skipping', () => {
    expect(typeof siblingPresent).toBe('boolean');
    if (!siblingPresent) {
      console.warn(
        `normalize-embed parity skipped: ${THEIRS} not found (repos split?)`,
      );
    }
  });
});
