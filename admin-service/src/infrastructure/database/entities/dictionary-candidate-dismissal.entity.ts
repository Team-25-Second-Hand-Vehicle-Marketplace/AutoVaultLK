import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * An admin's "not worth adding" decision on a raw make/model text that never
 * resolved during ingestion. Without this, dismissing a candidate would only
 * hide it for the current page load — the same noise (a typo, a blank, a
 * placeholder like "N/A") would reappear the next time the tab is opened.
 *
 * `rawValue` is stored normalized (lower-cased, trimmed) so a dismissal
 * suppresses every casing/whitespace variant of the same text, matching how
 * the candidate list itself is grouped.
 */
@Entity({ schema: 'admin', name: 'dictionary_candidate_dismissals' })
export class DictionaryCandidateDismissal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'dictionary_type', type: 'varchar', length: 20 })
  dictionaryType: string;

  @Column({ name: 'raw_value', type: 'varchar', length: 100 })
  rawValue: string;

  @Column({ name: 'dismissed_by', type: 'uuid', nullable: true })
  dismissedBy: string | null;

  @CreateDateColumn({ name: 'dismissed_at', type: 'timestamptz' })
  dismissedAt: Date;
}
