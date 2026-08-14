import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

/**
 * The in-memory dictionary the deterministic parser matches against.
 *
 * Why in-memory rather than a query per token:
 *
 * The design doc describes Stage 4 fuzzy matching as "pg_trgm", which reads
 * as a database round-trip. Doing that literally would mean one round-trip
 * per unresolved token — a five-token query could be five sequential
 * round-trips inside a 2s NL-search budget that also has to absorb a Groq
 * call and an embedding computation.
 *
 * The vocabulary is ~30 makes, ~133 models and ~10 body types. Trigram
 * similarity over ~175 short strings is microseconds in process. So the
 * table is loaded once and matched in memory, and `trigram.ts` reimplements
 * Postgres's similarity algorithm exactly so results are identical either way.
 *
 * This mirrors the precedent already set by SearchOptionsService, which
 * caches the same table for the same reason: it changes when someone runs a
 * seed or an admin adds a make, not during a browsing session.
 *
 * The accepted cost: an admin adding an alias does not affect parsing until
 * the TTL expires. Since the alias-promotion loop is a slow background
 * process, a few minutes of staleness is irrelevant to it.
 */

export interface DictEntry {
  id: string;
  parentId: string | null;
  /** The value written into filters — exactly as stored on vehicles rows. */
  canonicalValue: string;
  /** Lowercased canonical value. What matchers compare against. */
  normalized: string;
  vehicleTypes: string[];
  /** Lowercased aliases. An alias hit is an exact hit, not a fuzzy one. */
  aliases: string[];
}

export interface DictionaryCache {
  /**
   * Canonical values AND every alias, lowercased, mapped to their entry.
   * Aliases live here rather than in a separate fuzzy path because a known
   * misspelling is a *known* value — resolving "toyata" should cost the same
   * as resolving "toyota", and that zero-cost resolution is the entire payoff
   * of the alias-promotion loop.
   */
  makeExact: Map<string, DictEntry>;
  modelExact: Map<string, DictEntry>;

  makesById: Map<string, DictEntry>;
  modelsByMakeId: Map<string, DictEntry[]>;

  /** Flat lists for the Stage 4 trigram scan. */
  allMakes: DictEntry[];
  allModels: DictEntry[];

  /**
   * Every multi-word canonical value and alias, lowercased, mapped to the
   * entry it resolves to — "land cruiser", "land cruser", "rav 4", "town
   * ace", "ashok leyland". Stage 1 consumes this; without it the tokenizer's
   * word split would hand "land" and "cruiser" to Stage 3 as two tokens that
   * each match nothing.
   */
  makePhrases: Map<string, DictEntry>;
  modelPhrases: Map<string, DictEntry>;

  loadedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000;

interface DictRow {
  id: string;
  parent_id: string | null;
  dictionary_type: string;
  canonical_value: string;
  vehicle_types: string[] | null;
  aliases: string[] | null;
}

@Injectable()
export class VehicleDictionaryRepository {
  private readonly logger = new Logger(VehicleDictionaryRepository.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private cache: DictionaryCache | null = null;
  /**
   * De-duplicates concurrent loads. Without it, N requests arriving on a cold
   * cache each fire their own dictionary query; with it they all await the
   * same promise.
   */
  private inFlight: Promise<DictionaryCache> | null = null;

  async getCache(): Promise<DictionaryCache> {
    const cached = this.cache;
    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached;
    }

    if (this.inFlight) return this.inFlight;

    this.inFlight = this.load()
      .then((loaded) => {
        this.cache = loaded;
        return loaded;
      })
      .catch((error) => {
        // A dictionary read failure must not take down search. Serving a
        // stale cache is strictly better than failing the request; only a
        // cold-cache failure propagates, and the parser treats an empty
        // dictionary as "resolve nothing" rather than throwing.
        this.logger.error(`Dictionary load failed: ${error?.message ?? error}`);
        if (this.cache) return this.cache;
        return emptyCache();
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  /** Drops the cache so the next read reloads. For seeds, admin edits, tests. */
  invalidate(): void {
    this.cache = null;
  }

  private async load(): Promise<DictionaryCache> {
    const rows: DictRow[] = await this.dataSource.query(
      `SELECT id, parent_id, dictionary_type, canonical_value, vehicle_types, aliases
         FROM marketplace.vehicle_dictionaries
        WHERE is_active = true`,
    );

    return buildCache(rows);
  }
}

/** Exported for unit tests, which build a cache from fixture rows, not a DB. */
export function buildCache(rows: DictRow[]): DictionaryCache {
  const cache = emptyCache();

  const entries = rows.map(toEntry);

  for (const [entry, row] of entries.map((e, i) => [e, rows[i]] as const)) {
    const type = row.dictionary_type;

    if (type === 'MAKE') {
      cache.allMakes.push(entry);
      cache.makesById.set(entry.id, entry);
      indexExact(cache.makeExact, cache.makePhrases, entry);
    } else if (type === 'MODEL') {
      cache.allModels.push(entry);
      indexExact(cache.modelExact, cache.modelPhrases, entry);

      if (entry.parentId) {
        const siblings = cache.modelsByMakeId.get(entry.parentId) ?? [];
        siblings.push(entry);
        cache.modelsByMakeId.set(entry.parentId, siblings);
      }
    }
    // BODY_TYPE and COLOR rows are read from KNOWN_SPEC_KEYS instead — the
    // entity docs are explicit that small closed enums are not dictionary
    // vocabulary. They are skipped here rather than indexed unused.
  }

  cache.loadedAt = Date.now();
  return cache;
}

/**
 * Writes an entry into the exact index under its canonical value and every
 * alias, routing multi-word forms into the phrase index as well.
 *
 * A value can legitimately appear in both: "Land Cruiser" is a phrase for
 * Stage 1, and its alias "landcruiser" is a single-token exact hit for
 * Stage 3. Both must resolve to the same entry.
 *
 * First write wins on collision. Two makes sharing a name would be a seed
 * bug (the partial unique index added in migration 22000 exists to prevent
 * exactly that), and silently preferring the later row would make the
 * resolution order depend on unordered query results.
 */
function indexExact(
  exact: Map<string, DictEntry>,
  phrases: Map<string, DictEntry>,
  entry: DictEntry,
): void {
  const forms = [entry.normalized, ...entry.aliases];

  for (const form of forms) {
    if (form.length === 0) continue;

    const target = form.includes(' ') ? phrases : exact;
    if (!target.has(form)) target.set(form, entry);
  }
}

function toEntry(row: DictRow): DictEntry {
  return {
    id: row.id,
    parentId: row.parent_id,
    canonicalValue: row.canonical_value,
    normalized: normalizeValue(row.canonical_value),
    vehicleTypes: row.vehicle_types ?? [],
    aliases: (row.aliases ?? []).map(normalizeValue).filter((a) => a.length > 0),
  };
}

/**
 * Lowercase and collapse whitespace, and nothing else.
 *
 * Deliberately does NOT strip hyphens: the tokenizer preserves them between
 * letters, so "Mercedes-Benz" arrives as one hyphenated token and has to
 * match a hyphenated dictionary key. Stripping here would break that match.
 */
function normalizeValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function emptyCache(): DictionaryCache {
  return {
    makeExact: new Map(),
    modelExact: new Map(),
    makesById: new Map(),
    modelsByMakeId: new Map(),
    allMakes: [],
    allModels: [],
    makePhrases: new Map(),
    modelPhrases: new Map(),
    loadedAt: Date.now(),
  };
}
