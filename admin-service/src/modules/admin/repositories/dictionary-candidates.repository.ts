import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DictionaryCandidateDismissal } from '../../../infrastructure/database/entities/dictionary-candidate-dismissal.entity';
import { RejectedRecordView } from '../../../infrastructure/database/entities/rejected-record.view-entity';
import { VehicleDictionaryView } from '../../../infrastructure/database/entities/vehicle-dictionary.view-entity';

export type CandidateSample = {
  make: string | null;
  model: string | null;
  description: string | null;
};

export type RawCandidate = {
  normalizedValue: string;
  displayValue: string;
  occurrences: number;
  dealerCount: number;
  samples: CandidateSample[];
};

export type DictionaryEntrySummary = {
  id: string;
  canonicalValue: string;
};

/**
 * Read/write for the admin "New vehicle types" tab.
 *
 * The candidate query and the dictionary lookup both read across schemas
 * admin_service_role only holds SELECT on (ingestion, marketplace) - this
 * repository never writes to either; `dismiss` is the only write, and it
 * lands in admin's own schema. Promoting a candidate into the real
 * dictionary goes through MarketplaceInternalClient instead, the same way
 * every other admin-initiated write into another service's schema does.
 */
@Injectable()
export class DictionaryCandidatesRepository {
  constructor(
    @InjectRepository(RejectedRecordView)
    private readonly rejectedRecords: Repository<RejectedRecordView>,
    @InjectRepository(VehicleDictionaryView)
    private readonly dictionary: Repository<VehicleDictionaryView>,
    @InjectRepository(DictionaryCandidateDismissal)
    private readonly dismissals: Repository<DictionaryCandidateDismissal>,
  ) {}

  /**
   * Raw make text that never resolved during ingestion, grouped by its
   * normalized form, with enough context for an admin to tell a genuinely
   * new vehicle type apart from noise: how often it recurs, across how many
   * dealers, and a few real rows it appeared on. Already excludes anything
   * an admin previously dismissed.
   *
   * `reason LIKE` matches validateRows.stage.ts's `missing()` helper exactly
   * (`make "X" could not be recognised`) - the one place in the pipeline
   * that produces this message. `raw_data->>'make'` is read directly rather
   * than parsed back out of the reason string, since it is the same value
   * structured rather than embedded in prose.
   */
  async findCandidates(minOccurrences: number): Promise<RawCandidate[]> {
    const rows: Array<{
      normalized_make: string;
      display_value: string;
      occurrences: string;
      dealer_count: string;
      samples: CandidateSample[];
    }> = await this.rejectedRecords.query(
      `
      WITH make_rejections AS (
        SELECT
          r.raw_data ->> 'make' AS raw_make,
          LOWER(TRIM(r.raw_data ->> 'make')) AS normalized_make,
          r.raw_data ->> 'model' AS raw_model,
          r.raw_data ->> 'description' AS raw_description,
          r.created_at,
          j.dealer_id
        FROM ingestion.rejected_records r
        JOIN ingestion.upload_jobs j ON j.id = r.upload_job_id
        WHERE r.stage = 'VALIDATE_ROWS'
          AND r.reason LIKE 'make "%" could not be recognised'
          AND TRIM(COALESCE(r.raw_data ->> 'make', '')) <> ''
      )
      SELECT
        mr.normalized_make,
        (array_agg(mr.raw_make ORDER BY mr.created_at DESC))[1] AS display_value,
        COUNT(*)::int AS occurrences,
        COUNT(DISTINCT mr.dealer_id)::int AS dealer_count,
        (array_agg(
          jsonb_build_object('make', mr.raw_make, 'model', mr.raw_model, 'description', mr.raw_description)
          ORDER BY mr.created_at DESC
        ))[1:3] AS samples
      FROM make_rejections mr
      WHERE NOT EXISTS (
        SELECT 1 FROM admin.dictionary_candidate_dismissals d
        WHERE d.dictionary_type = 'MAKE' AND d.raw_value = mr.normalized_make
      )
      GROUP BY mr.normalized_make
      HAVING COUNT(*) >= $1
      ORDER BY occurrences DESC
      `,
      [minOccurrences],
    );

    return rows.map((row) => ({
      normalizedValue: row.normalized_make,
      displayValue: row.display_value,
      occurrences: Number(row.occurrences),
      dealerCount: Number(row.dealer_count),
      samples: row.samples,
    }));
  }

  /** Active makes to score a candidate's raw text against. */
  async findMakes(): Promise<DictionaryEntrySummary[]> {
    const entries = await this.dictionary.find({
      where: { dictionaryType: 'MAKE', isActive: true },
      select: { id: true, canonicalValue: true },
    });
    return entries;
  }

  /**
   * Records that an admin looked at this raw text and decided it is not
   * worth adding. ON CONFLICT DO NOTHING: dismissing something already
   * dismissed (a second admin, a stale page) is a no-op, not an error.
   */
  async dismiss(rawValue: string, adminId: string | null): Promise<void> {
    await this.dismissals.query(
      `
      INSERT INTO admin.dictionary_candidate_dismissals (dictionary_type, raw_value, dismissed_by)
      VALUES ('MAKE', $1, $2)
      ON CONFLICT (dictionary_type, raw_value) DO NOTHING
      `,
      [rawValue, adminId],
    );
  }
}
