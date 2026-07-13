import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleDictionaryView } from '../../../infrastructure/database/entities/vehicle-dictionary.view-entity';
import {
  InMemoryDictionarySnapshot,
  type DictionaryRow,
} from '../../../workers/etl-worker/pipeline/normalize/dictionary-snapshot';

@Injectable()
export class DictionaryRepository {
  private readonly logger = new Logger(DictionaryRepository.name);

  constructor(
    @InjectRepository(VehicleDictionaryView)
    private readonly repo: Repository<VehicleDictionaryView>,
  ) {}

  async loadSnapshot(): Promise<InMemoryDictionarySnapshot> {
    // Inactive entries are excluded rather than filtered later: a retired make
    // must not silently keep resolving for new uploads.
    const rows = await this.repo.find({ where: { isActive: true } });

    const snapshot = new InMemoryDictionarySnapshot(
      rows.map(
        (row): DictionaryRow => ({
          id: row.id,
          parentId: row.parentId,
          dictionaryType: row.dictionaryType,
          canonicalValue: row.canonicalValue,
          // aliases is jsonb; a malformed row must not take down the run.
          aliases: Array.isArray(row.aliases) ? row.aliases : [],
          vehicleTypes: Array.isArray(row.vehicleTypes) ? row.vehicleTypes : [],
        }),
      ),
    );

    this.logger.log(`Dictionary snapshot loaded: ${snapshot.size} active entries`);
    return snapshot;
  }
}
