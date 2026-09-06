import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VehicleDictionaryView } from '../../../infrastructure/database/entities/vehicle-dictionary.view-entity';
import {
  InMemoryDictionarySnapshot,
  type DictionaryRow,
} from '../../../workers/etl-worker/pipeline/normalize/dictionary-snapshot';

/**
 * Loads marketplace.vehicle_dictionaries into an in-memory snapshot.
 *
 * One query per pipeline run, never per row — that is what keeps the
 * `extra: { max: 5 }` connection-pool sizing in config/database.config.ts
 * valid under MaxConcurrency: 10.
 *
 * SELECT only: ingestion_service_role has no write grant here, and alias
 * promotion goes through marketplace-service's API rather than a second
 * cross-schema write (see the view-entity header and ADR-002).
 */
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
