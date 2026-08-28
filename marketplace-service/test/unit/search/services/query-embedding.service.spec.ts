import { ConfigService } from '@nestjs/config';
import { QueryEmbeddingService } from '../../../../src/modules/search/services/query-embedding.service';
import type { Embedder } from '../../../../src/shared/normalize-embed';
import { EMBEDDING_DIMENSIONS } from '../../../../src/shared/normalize-embed';

describe('QueryEmbeddingService', () => {
  const vector = new Array(EMBEDDING_DIMENSIONS).fill(0);
  vector[0] = 1;

  function makeService(embedder: Embedder, env: Record<string, string | undefined> = {}) {
    const config = { get: (key: string) => env[key] } as unknown as ConfigService;
    return new QueryEmbeddingService(config, embedder);
  }

  it('returns null for empty leftover text so ranking is skipped (NFR-12.1)', async () => {
    const embed = jest.fn();
    const service = makeService({ embed });
    expect(await service.embedQuery('   ')).toBeNull();
    expect(embed).not.toHaveBeenCalled();
  });

  it('returns null when embeddings are disabled', async () => {
    const embed = jest.fn();
    const service = makeService({ embed }, { EMBEDDING_DISABLED: 'true' });
    expect(await service.embedQuery('leather seats')).toBeNull();
    expect(embed).not.toHaveBeenCalled();
  });

  it('returns the vector when MiniLM succeeds', async () => {
    const service = makeService({ embed: async () => vector });
    expect(await service.embedQuery('leather')).toEqual(vector);
  });

  it('returns null when MiniLM throws rather than failing the search', async () => {
    const service = makeService({
      embed: async () => {
        throw new Error('onnx missing');
      },
    });
    expect(await service.embedQuery('leather')).toBeNull();
  });
});
