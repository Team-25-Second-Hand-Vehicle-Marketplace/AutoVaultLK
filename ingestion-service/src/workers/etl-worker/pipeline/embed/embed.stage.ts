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

/**
 * The ~90MB ONNX model, cached for the life of the process.
 *
 * A module singleton rather than a class field because stages are plain
 * objects, not injectables — the same posture as
 * marketplace-service's ListingSearchIndexService and QueryEmbeddingService,
 * which both cache for the same reason. Loading per chunk under
 * MaxConcurrency 10 would mean ten simultaneous model loads.
 */
let cachedEmbedder: Embedder | undefined;

/** Test seam: the model is far too slow to load in a unit test. */
export function __setEmbedder(embedder: Embedder | undefined): void {
  cachedEmbedder = embedder;
}

function getEmbedder(): Embedder {
  if (!cachedEmbedder) cachedEmbedder = createXenovaEmbedder();
  return cachedEmbedder;
}

/**
 * Builds search_text and the 384-dimension vector for every row.
 *
 * **This is where FR-22.1 / NFR-26.1 model parity is enforced.** The fields
 * below are exactly those marketplace-service's ListingSearchIndexService
 * passes for a manually created listing — same fields, same order, same
 * source module. An embedding is only meaningful relative to vectors built the
 * same way, so if these two ever diverge, bulk listings land in a different
 * region of vector space and rank badly forever: no error, no failing test, no
 * log line (plan-b §9A calls this silent drift).
 *
 * Two guards stand behind that claim. test/unit/shared/normalize-embed-parity
 * asserts our copy of the shared module is byte-identical to marketplace's,
 * and this stage's spec asserts the text produced here matches what the
 * manual path produces for an equivalent vehicle. Changing the field list here
 * without changing ListingSearchIndexService breaks the second.
 *
 * A missing vector is never a row failure — it matches the manual path, which
 * saves the listing and logs a warning. The row still has search_text, so the
 * lexical half of hybrid search finds it; only vector similarity is lost, and
 * a re-embed can repair that later. Refusing the row could not.
 */
export const embedStage: StageRunner<EnrichedRow[], EmbedResult> = {
  stage: 'EMBED',

  async run(ctx: StageContext, rows: EnrichedRow[]): Promise<EmbedResult> {
    // The whole file's text is still built when embeddings are off, so
    // search_text — and therefore the trigger-maintained search_vector — is
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
        // No text means nothing to embed. Cannot happen for a validated row —
        // make, model and year are all required — but a null vector is the
        // honest result rather than an embedding of the empty string.
        embedded.push({ ...row, searchText: null, embedding: null });
        continue;
      }

      // One failure means the model is unavailable, not that a particular row
      // is special. Every subsequent row skips the call rather than paying the
      // load timeout again — at chunkSize 250 that is the difference between
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

/**
 * The fields ListingSearchIndexService passes, in the same order.
 *
 * Do not reorder, add or remove a field here without making the identical
 * change in marketplace-service/src/modules/listings/services/
 * listing-search-index.service.ts and re-running
 * `cd database && npm run seed:embeddings` — every embedding already stored is
 * invalidated by a change to this shape.
 */
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
