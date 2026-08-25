import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

import {
  EMBEDDING_MODEL_ID,
  createXenovaEmbedder,
  toPgVector,
} from '../../../marketplace-service/src/shared/normalize-embed';

config({ path: '../.env' });

/**
 * Backfills marketplace.vehicles.embedding from search_text (FR-22 / FR-36).
 *
 * Stands in for the ingestion EmbedHandler until the ETL pipeline exists.
 * Deliberately imports marketplace-service's shared normalize-embed module
 * rather than re-implementing MiniLM here: FR-22.1 requires listing vectors
 * and query vectors to come from one shared library, identical in model,
 * version, pooling and normalization. A second copy of that config is exactly
 * the drift the requirement forbids — vectors from two models occupy
 * incompatible spaces and degrade silently rather than erroring (FR-22.2).
 *
 * Idempotent: only rows WHERE embedding IS NULL are touched, so re-running
 * after a partial failure resumes instead of re-embedding everything.
 * Pass --all to force a full regeneration (needed after a model change).
 */

/** Rows per UPDATE round-trip. Vectors are ~6 KB of text each as pgvector literals. */
const BATCH_SIZE = 25;

type Row = { id: string; search_text: string | null };

async function seedEmbeddings() {
  const forceAll = process.argv.includes('--all');

  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [],
    synchronize: false,
    // Opt-in TLS so this can seed RDS (which forces SSL) as well as local
    // Docker Postgres (which serves no certificate).
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await ds.initialize();

  // Embedding a listing with no search_text would produce a vector for the
  // empty string — a real point in the space that sits near nothing in
  // particular, making the row a spurious match for unrelated queries.
  // Leaving it NULL keeps it honestly unranked instead.
  const rows: Row[] = await ds.query(
    `SELECT id, search_text
       FROM marketplace.vehicles
      WHERE search_text IS NOT NULL
        AND btrim(search_text) <> ''
        ${forceAll ? '' : 'AND embedding IS NULL'}
      ORDER BY created_at`,
  );

  if (rows.length === 0) {
    console.log(
      forceAll
        ? 'No vehicles with search_text to embed.'
        : 'All vehicles already have embeddings. Use --all to regenerate.',
    );
    await ds.destroy();
    return;
  }

  console.log(
    `Embedding ${rows.length} vehicle(s) with ${EMBEDDING_MODEL_ID}` +
      `${forceAll ? ' (forced full regeneration)' : ''}…`,
  );
  console.log('  First call loads the ~90 MB ONNX model; this may take a minute.');

  const embedder = createXenovaEmbedder();
  let done = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    // Sequential rather than Promise.all: the ONNX runtime is CPU-bound and
    // single-threaded here, so concurrent calls contend for the same core and
    // add memory pressure without improving throughput.
    for (const row of batch) {
      const vector = await embedder.embed(row.search_text as string);

      await ds.query(
        `UPDATE marketplace.vehicles SET embedding = $2::vector WHERE id = $1`,
        [row.id, toPgVector(vector)],
      );

      done++;
    }

    console.log(`  ${done}/${rows.length}`);
  }

  const [{ count: remaining }] = await ds.query(
    `SELECT COUNT(*)::int AS count
       FROM marketplace.vehicles
      WHERE status = 'LIVE'
        AND embedding IS NULL`,
  );

  console.log(`  ${done} vehicle(s) embedded.`);
  if (remaining > 0) {
    // Not an error: these are the blank-search_text rows skipped above. Worth
    // surfacing because they can never be reached by semantic ranking.
    console.log(`  Note: ${remaining} LIVE vehicle(s) still have no embedding.`);
  }

  await ds.destroy();
}

seedEmbeddings().catch((err) => {
  console.error('Embedding seed failed:', err);
  process.exit(1);
});
