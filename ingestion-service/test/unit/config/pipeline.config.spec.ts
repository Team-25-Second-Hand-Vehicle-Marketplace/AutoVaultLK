import type { ConfigService } from '@nestjs/config';
import {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_GROQ_CONFIDENCE_THRESHOLD,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_MAX_UPLOAD_MB,
  maxUploadBytes,
  pipelineConfig,
} from '../../../src/config/pipeline.config';

const configWith = (values: Record<string, string>): ConfigService =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('pipelineConfig', () => {
  it('falls back to the documented defaults when nothing is set', () => {
    expect(pipelineConfig(configWith({}))).toEqual({
      maxConcurrency: DEFAULT_MAX_CONCURRENCY,
      chunkSize: DEFAULT_CHUNK_SIZE,
      groqConfidenceThreshold: DEFAULT_GROQ_CONFIDENCE_THRESHOLD,
      embeddingDisabled: false,
    });
  });

  it('reads overrides from the environment', () => {
    expect(
      pipelineConfig(
        configWith({
          INGESTION_MAX_CONCURRENCY: '4',
          INGESTION_CHUNK_SIZE: '50',
          INGESTION_GROQ_CONFIDENCE_THRESHOLD: '0.8',
          EMBEDDING_DISABLED: 'true',
        }),
      ),
    ).toEqual({
      maxConcurrency: 4,
      chunkSize: 50,
      groqConfidenceThreshold: 0.8,
      embeddingDisabled: true,
    });
  });

  // A concurrency of 0 stalls the Map state rather than failing loudly, so
  // nonsense falls back instead of propagating.
  it.each([['0'], ['-3'], ['abc'], ['']])('ignores invalid concurrency %j', (value) => {
    expect(
      pipelineConfig(configWith({ INGESTION_MAX_CONCURRENCY: value })).maxConcurrency,
    ).toBe(DEFAULT_MAX_CONCURRENCY);
  });

  it.each([['1.5'], ['-0.2'], ['nope']])(
    'ignores out-of-range confidence threshold %j',
    (value) => {
      expect(
        pipelineConfig(configWith({ INGESTION_GROQ_CONFIDENCE_THRESHOLD: value }))
          .groqConfidenceThreshold,
      ).toBe(DEFAULT_GROQ_CONFIDENCE_THRESHOLD);
    },
  );

  it('accepts 0 and 1 as meaningful threshold bounds', () => {
    expect(
      pipelineConfig(configWith({ INGESTION_GROQ_CONFIDENCE_THRESHOLD: '0' }))
        .groqConfidenceThreshold,
    ).toBe(0);
    expect(
      pipelineConfig(configWith({ INGESTION_GROQ_CONFIDENCE_THRESHOLD: '1' }))
        .groqConfidenceThreshold,
    ).toBe(1);
  });

  // A typo must not silently ship listings with no vector.
  it.each([['TRUE'], ['1'], ['yes'], ['']])(
    'treats EMBEDDING_DISABLED=%j as not disabled',
    (value) => {
      expect(pipelineConfig(configWith({ EMBEDDING_DISABLED: value })).embeddingDisabled).toBe(
        false,
      );
    },
  );
});

describe('maxUploadBytes', () => {
  it('converts megabytes to bytes', () => {
    expect(maxUploadBytes(configWith({ INGESTION_MAX_UPLOAD_MB: '10' }))).toBe(
      10 * 1024 * 1024,
    );
  });

  it('defaults when unset', () => {
    expect(maxUploadBytes(configWith({}))).toBe(DEFAULT_MAX_UPLOAD_MB * 1024 * 1024);
  });
});
