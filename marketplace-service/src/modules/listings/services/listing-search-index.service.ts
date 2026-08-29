import { Injectable, Logger } from '@nestjs/common';

import { Vehicle } from '../../../infrastructure/database/entities/vehicle.entity';
import {
  buildSearchText,
  createXenovaEmbedder,
  toPgVector,
  type Embedder,
} from '../../../shared/normalize-embed';

export type SearchIndexFields = {
  searchText: string | null;
  embedding: string | null;
};

/**
 * Builds the search_text/embedding pair for a listing. Kept as one service so
 * create and update always derive both fields the same way (FR-13.1/13.2) —
 * the embedder loads a ~90MB ONNX model on first use, so it is cached here as
 * a singleton for the life of the process, same as QueryEmbeddingService.
 */
@Injectable()
export class ListingSearchIndexService {
  private readonly logger = new Logger(ListingSearchIndexService.name);
  private embedder: Embedder | undefined;

  async build(vehicle: Vehicle): Promise<SearchIndexFields> {
    const searchText = buildSearchText({
      make: vehicle.make,
      model: vehicle.model,
      manufactureYear: vehicle.manufactureYear,
      vehicleType: vehicle.vehicleType,
      fuelType: vehicle.fuelType,
      transmissionType: vehicle.transmissionType,
      locationCity: vehicle.locationCity,
      locationDistrict: vehicle.locationDistrict,
      specs: vehicle.specs,
      description: vehicle.description,
    });

    const trimmed = searchText.trim();
    if (!trimmed) {
      return { searchText: null, embedding: null };
    }

    try {
      const vector = await this.getEmbedder().embed(trimmed);
      return { searchText: trimmed, embedding: toPgVector(vector) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`MiniLM unavailable (${message}); saving listing without embedding`);
      return { searchText: trimmed, embedding: null };
    }
  }

  private getEmbedder(): Embedder {
    if (!this.embedder) this.embedder = createXenovaEmbedder();
    return this.embedder;
  }
}
