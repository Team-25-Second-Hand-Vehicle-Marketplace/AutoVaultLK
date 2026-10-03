import {
  buildSearchText,
  createXenovaEmbedder,
  toPgVector,
  type Embedder,
} from '../../../../shared/normalize-embed';
import type {
  EmbeddedRow,
  EnrichedRow,
  StageContext,
  StageResult,
  StageRunner,
} from '../types';

export type EmbedOutcome = 'SUCCEEDED' | 'SKIPPED' | 'DEGRADED';

export type EmbedResult = StageResult<EmbeddedRow> & {
  outcome: EmbedOutcome;
  metrics: { embedded: number; withoutVector: number };
};

let cachedEmbedder: Embedder | undefined;

/** Test seam: the model is far too slow to load in a unit test. */
export function __setEmbedder(embedder: Embedder | undefined): void {
  cachedEmbedder = embedder;
}

function getEmbedder(): Embedder {
  if (!cachedEmbedder) cachedEmbedder = createXenovaEmbedder();
  return cachedEmbedder;
}

export const embedStage: StageRunner<EnrichedRow[], EmbedResult> = {
  stage: 'EMBED',

  async run(ctx: StageContext, rows: EnrichedRow[]): Promise<EmbedResult> {
    // The whole file's text is still built when embeddings are off, so
    // search_text - and therefore the trigger-maintained search_vector - is
    // populated either way. Lexical search keeps working with EMBEDDING_DISABLED.
    const texts = rows.map((row) => ({ row, text: searchTextFor(row) }));

    if (ctx.config.embeddingDisabled) {
      return {
        rows: texts.map(({ row, text }) => ({ ...row, searchText: text, embedding: null })),
        rejections: [],
        outcome: 'SKIPPED',
        metrics: { embedded: 0, withoutVector: rows.length },
      };
    }

    const embedded: EmbeddedRow[] = [];
    let degraded = false;
    let withVector = 0;

    for (const { row, text } of texts) {
      if (!text) {
        // No text means nothing to embed. Cannot happen for a validated row -
        // make, model and year are all required - but a null vector is the
        // honest result rather than an embedding of the empty string.
        embedded.push({ ...row, searchText: null, embedding: null });
        continue;
      }

      // One failure means the model is unavailable, not that a particular row
      // is special. Every subsequent row skips the call rather than paying the
      // load timeout again - at chunkSize 250 that is the difference between
      // one failure and 250.
      if (degraded) {
        embedded.push({ ...row, searchText: text, embedding: null });
        continue;
      }

      try {
        const vector = await getEmbedder().embed(text);
        embedded.push({ ...row, searchText: text, embedding: toPgVector(vector) });
        withVector++;
      } catch {
        degraded = true;
        embedded.push({ ...row, searchText: text, embedding: null });
      }
    }

    return {
      rows: embedded,
      rejections: [],
      outcome: degraded ? 'DEGRADED' : 'SUCCEEDED',
      metrics: { embedded: withVector, withoutVector: rows.length - withVector },
    };
  },
};

export function searchTextFor(row: EnrichedRow): string | null {
  const f = row.normalized;

  const text = buildSearchText({
    make: f.make,
    model: f.model,
    manufactureYear: f.manufactureYear,
    vehicleType: f.vehicleType,
    condition: f.condition,
    fuelType: f.fuelType,
    transmissionType: f.transmissionType,
    price: f.price,
    mileage: f.mileage,
    locationCity: f.locationCity,
    locationDistrict: f.locationDistrict,
    specs: f.specs,
    description: f.description,
  });

  // trim() and the empty-to-null fold match ListingSearchIndexService exactly;
  // an untrimmed text would embed differently from the manual equivalent.
  const trimmed = text.trim();
  return trimmed || null;
}
