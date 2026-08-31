import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type AliasCandidate = {
  token: string;
  occurrences: number;
};

export type DictionaryEntry = {
  id: string;
  dictionaryType: string;
  canonicalValue: string;
  aliases: string[];
};

@Injectable()
export class AliasPromotionRepository {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Find unresolved search terms that have appeared
   * frequently enough to be considered for promotion.
   */
  async findAliasCandidates(minOccurrences: number): Promise<AliasCandidate[]> {
    const rows: Array<{
      token: string;
      occurrences: number;
    }> = await this.dataSource.query(
      `
      SELECT
        LOWER(TRIM(token)) AS token,
        COUNT(*)::int AS occurrences
      FROM (
        SELECT
          jsonb_array_elements_text(unresolved_tokens) AS token
        FROM marketplace.search_queries
        WHERE unresolved_tokens IS NOT NULL
          AND jsonb_array_length(unresolved_tokens) > 0
      ) AS unresolved
      WHERE LENGTH(TRIM(token)) >= 4
      GROUP BY LOWER(TRIM(token))
      HAVING COUNT(*) >= $1
      ORDER BY occurrences DESC
      `,
      [minOccurrences],
    );

    return rows;
  }

  /**
   * Get active dictionary values that can be used
   * as possible canonical values for an alias.
   */
  async findDictionaryEntries(): Promise<DictionaryEntry[]> {
    const rows: Array<{
      id: string;
      dictionary_type: string;
      canonical_value: string;
      aliases: unknown;
    }> = await this.dataSource.query(
      `
      SELECT
        id,
        dictionary_type,
        canonical_value,
        aliases
      FROM marketplace.vehicle_dictionaries
      WHERE is_active = true
      ORDER BY dictionary_type, canonical_value
      `,
    );

    return rows.map((row) => ({
      id: row.id,
      dictionaryType: row.dictionary_type,
      canonicalValue: row.canonical_value,
      aliases: this.toStringArray(row.aliases),
    }));
  }

  /**
   * Add a new alias to an existing dictionary entry.
   *
   * The update is conditional so the same alias is not
   * accidentally added twice.
   */
  async addAlias(dictionaryId: string, alias: string): Promise<boolean> {
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `
        UPDATE marketplace.vehicle_dictionaries
        SET aliases = (
          SELECT jsonb_agg(value)
          FROM (
            SELECT DISTINCT value
            FROM jsonb_array_elements_text(
              COALESCE(aliases, '[]'::jsonb)
            )
            UNION ALL
            SELECT $2::text
          ) AS values
        )
        WHERE id = $1
          AND NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(
              COALESCE(aliases, '[]'::jsonb)
            ) AS existing(value)
            WHERE LOWER(existing.value) = LOWER($2)
          )
        RETURNING id
        `,
      [dictionaryId, alias],
    );

    return rows.length > 0;
  }

  private toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }

    if (typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value);
        return this.toStringArray(parsed);
      } catch {
        return [];
      }
    }

    return [];
  }
}
