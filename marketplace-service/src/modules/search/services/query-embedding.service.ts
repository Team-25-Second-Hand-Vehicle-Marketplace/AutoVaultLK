import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createXenovaEmbedder, type Embedder } from '../../../shared/normalize-embed';

export const QUERY_EMBEDDER = 'QUERY_EMBEDDER';

/**
 * Query-time MiniLM (FR-22). Returns null when there is nothing to embed,
 * the model is disabled, or the ONNX runtime fails to load — callers then
 * skip vector ranking instead of failing the search (FR-24 / NFR-12.1).
 */
@Injectable()
export class QueryEmbeddingService {
  private readonly logger = new Logger(QueryEmbeddingService.name);
  private embedder: Embedder | undefined;

  constructor(
    private readonly config: ConfigService,
    @Optional() @Inject(QUERY_EMBEDDER) embedder?: Embedder,
  ) {
    this.embedder = embedder;
  }

  async embedQuery(text: string): Promise<number[] | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (this.config.get('EMBEDDING_DISABLED') === 'true') return null;

    try {
      const embedder = this.getEmbedder();
      return await embedder.embed(trimmed);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`MiniLM unavailable (${message}); skipping semantic ranking`);
      return null;
    }
  }

  private getEmbedder(): Embedder {
    if (!this.embedder) this.embedder = createXenovaEmbedder();
    return this.embedder;
  }
}
