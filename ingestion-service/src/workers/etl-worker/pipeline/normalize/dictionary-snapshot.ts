import type {
  DictionaryHit,
  DictionarySnapshot,
} from '../types';
import { compact, trigramSimilarity } from './trigram';

/** One dictionary row, as loaded from marketplace.vehicle_dictionaries. */
export type DictionaryRow = {
  id: string;
  parentId: string | null;
  dictionaryType: string;
  canonicalValue: string;
  aliases: string[];
  vehicleTypes: string[];
};

/**
 * Confidence assigned by match quality. parseNormalize compares the row's
 * lowest field confidence against INGESTION_GROQ_CONFIDENCE_THRESHOLD
 * (default 0.6), so a fuzzy hit sits exactly on the boundary and an
 * unresolved value falls well below it.
 */
export const CONFIDENCE_EXACT = 1.0;
export const CONFIDENCE_ALIAS = 0.8;
export const CONFIDENCE_FUZZY = 0.6;

/**
 * Minimum trigram score for a fuzzy match. Same value as search's
 * TRIGRAM_THRESHOLD (marketplace-service/src/modules/search/parser/types.ts)
 * so both halves accept the same misspellings.
 */
export const TRIGRAM_THRESHOLD = 0.45;

/**
 * How far the best fuzzy candidate must beat the runner-up. Without this,
 * "Corola" scoring 0.72 against Corolla and 0.71 against Corsa would silently
 * pick one — a coin flip written into a dealer's inventory. Below the margin
 * the value is left unresolved and the row falls to the Groq stage instead.
 */
export const AMBIGUITY_MARGIN = 0.05;

/** Fuzzy matching needs enough signal; 3-char probes trigram-match everything. */
const MIN_FUZZY_PROBE_LENGTH = 4;

/**
 * In-memory view of marketplace.vehicle_dictionaries, built once per pipeline
 * run.
 *
 * Deliberately NOT a per-row query: the ETL holds a single connection under
 * Step Functions' MaxConcurrency of 10, and `extra: { max: 5 }` in
 * config/database.config.ts is sized on that assumption. Querying per row would
 * invalidate the whole pooling argument (see the view-entity's header).
 *
 * Resolution order is exact → alias → fuzzy, mirroring search's parser so the
 * two halves of the platform fold the same dealer input to the same canonical
 * value.
 */
export class InMemoryDictionarySnapshot implements DictionarySnapshot {
  /** compact(value) → rows. A key can collide across types, hence the filter. */
  private readonly byKey = new Map<string, IndexedEntry[]>();
  private readonly all: IndexedEntry[];

  constructor(rows: DictionaryRow[]) {
    this.all = rows.map((row) => ({
      row,
      canonicalKey: compact(row.canonicalValue),
      aliasKeys: row.aliases.map(compact),
    }));

    for (const entry of this.all) {
      this.push(entry.canonicalKey, entry);
      for (const alias of entry.aliasKeys) {
        // An alias equal to the canonical adds nothing but a duplicate hit.
        if (alias !== entry.canonicalKey) this.push(alias, entry);
      }
    }
  }

  resolveMake(raw: string): DictionaryHit | null {
    return this.lookup(raw, (e) => e.row.dictionaryType === 'MAKE');
  }

  /**
   * Models are children of a make, so resolution is scoped by parent: a "Civic"
   * under Honda must not resolve when the row's make is Toyota. A null makeId
   * means the make itself was unresolved, in which case the model cannot be
   * trusted either.
   */
  resolveModel(raw: string, makeId: string | null): DictionaryHit | null {
    if (!makeId) return null;
    return this.lookup(
      raw,
      (e) => e.row.dictionaryType === 'MODEL' && e.row.parentId === makeId,
    );
  }

  resolve(type: string, raw: string): DictionaryHit | null {
    return this.lookup(raw, (e) => e.row.dictionaryType === type);
  }

  get size(): number {
    return this.all.length;
  }

  private push(key: string, entry: IndexedEntry): void {
    const existing = this.byKey.get(key);
    if (existing) existing.push(entry);
    else this.byKey.set(key, [entry]);
  }

  private lookup(
    raw: string,
    matches: (entry: IndexedEntry) => boolean,
  ): DictionaryHit | null {
    const probe = compact(raw ?? '');
    if (!probe) return null;

    const candidates = (this.byKey.get(probe) ?? []).filter(matches);

    // Exact canonical beats an alias that happens to share the key.
    const exact = candidates.find((e) => e.canonicalKey === probe);
    if (exact) return hit(exact, CONFIDENCE_EXACT);

    // An unambiguous alias hit. Two different rows claiming the same alias is
    // a dictionary bug, not something to guess at.
    if (candidates.length === 1) return hit(candidates[0], CONFIDENCE_ALIAS);
    if (candidates.length > 1) return null;

    return this.fuzzy(probe, matches);
  }

  private fuzzy(
    probe: string,
    matches: (entry: IndexedEntry) => boolean,
  ): DictionaryHit | null {
    if (probe.length < MIN_FUZZY_PROBE_LENGTH) return null;

    let best: IndexedEntry | null = null;
    let bestScore = 0;
    let runnerUp = 0;

    for (const entry of this.all) {
      if (!matches(entry)) continue;

      const score = bestSimilarity(probe, entry);
      if (score > bestScore) {
        runnerUp = bestScore;
        bestScore = score;
        best = entry;
      } else if (score > runnerUp) {
        runnerUp = score;
      }
    }

    if (!best || bestScore < TRIGRAM_THRESHOLD) return null;
    if (bestScore - runnerUp < AMBIGUITY_MARGIN) return null;

    return hit(best, CONFIDENCE_FUZZY);
  }
}

type IndexedEntry = {
  row: DictionaryRow;
  canonicalKey: string;
  aliasKeys: string[];
};

/** Best score across the canonical value and every alias. */
function bestSimilarity(probe: string, entry: IndexedEntry): number {
  let best = trigramSimilarity(probe, entry.canonicalKey);
  for (const alias of entry.aliasKeys) {
    best = Math.max(best, trigramSimilarity(probe, alias));
  }
  return best;
}

function hit(entry: IndexedEntry, confidence: number): DictionaryHit {
  return {
    id: entry.row.id,
    canonical: entry.row.canonicalValue,
    vehicleTypes: entry.row.vehicleTypes,
    confidence,
  };
}
