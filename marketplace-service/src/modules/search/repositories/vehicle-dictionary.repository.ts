import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { DictionaryEntry, ParserVocabulary } from '../parser/types';

type DictionaryRow = {
  dictionary_type: 'MAKE' | 'MODEL' | 'BODY_TYPE';
  canonical_value: string;
  aliases: unknown;
  vehicle_types: string[] | null;
  parent_canonical: string | null;
};

/** Same TTL as SearchOptionsService — dictionaries change on seed, not per request. */
const VOCAB_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Snapshot of vehicle_dictionaries for the deterministic parser.
 *
 * SAD §9: ingestion and search both cache this table in memory. The parser
 * itself stays a pure function; this repository is the only DB boundary.
 */
@Injectable()
export class VehicleDictionaryRepository {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private cache: { value: ParserVocabulary; expiresAt: number } | null = null;

  async getParserVocabulary(): Promise<ParserVocabulary> {
    const cached = this.cache;
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const rows: DictionaryRow[] = await this.dataSource.query(
      `SELECT
         child.dictionary_type,
         child.canonical_value,
         child.aliases,
         child.vehicle_types,
         parent.canonical_value AS parent_canonical
       FROM marketplace.vehicle_dictionaries child
       LEFT JOIN marketplace.vehicle_dictionaries parent
         ON parent.id = child.parent_id
       WHERE child.is_active = true
         AND child.dictionary_type IN ('MAKE', 'MODEL', 'BODY_TYPE')`,
    );

    const value = rowsToVocabulary(rows);
    this.cache = { value, expiresAt: Date.now() + VOCAB_CACHE_TTL_MS };
    return value;
  }
}

export function rowsToVocabulary(rows: DictionaryRow[]): ParserVocabulary {
  const makes: DictionaryEntry[] = [];
  const models: DictionaryEntry[] = [];
  const bodyTypes: DictionaryEntry[] = [];

  for (const row of rows) {
    const entry: DictionaryEntry = {
      canonical: row.canonical_value,
      aliases: asStringArray(row.aliases),
      vehicleTypes: row.vehicle_types ?? [],
      parentCanonical: row.parent_canonical ?? undefined,
    };
    if (row.dictionary_type === 'MAKE') makes.push(entry);
    else if (row.dictionary_type === 'MODEL') models.push(entry);
    else bodyTypes.push(entry);
  }

  return { makes, models, bodyTypes };
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  }
  return [];
}
