import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

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
