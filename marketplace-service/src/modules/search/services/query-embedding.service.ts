import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createXenovaEmbedder, type Embedder } from '../../../shared/normalize-embed';

export const QUERY_EMBEDDER = 'QUERY_EMBEDDER';

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
