import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ schema: 'marketplace', name: 'search_queries' })
export class SearchQuery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nullable — anonymous visitors search too
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'raw_text', type: 'text' })
  rawText: string;

  @Column({ name: 'extracted_filters', type: 'jsonb', default: () => `'{}'::jsonb` })
  extractedFilters: Record<string, unknown>;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 3,
    nullable: true,
    transformer: {
      to: (v: number | null) => v,
      from: (v: string | null) => (v === null ? null : parseFloat(v)),
    },
  })
  confidence: number | null;

  @Column({ name: 'used_llm', type: 'boolean', default: false })
  usedLlm: boolean;

  // The missing-vocabulary list that feeds the alias-promotion loop.
  @Column({ name: 'unresolved_tokens', type: 'jsonb', default: () => `'[]'::jsonb` })
  unresolvedTokens: string[];

  @Column({ name: 'result_count', type: 'integer', default: 0 })
  resultCount: number;

  @Column({ name: 'search_time_ms', type: 'integer', nullable: true })
  searchTimeMs: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
